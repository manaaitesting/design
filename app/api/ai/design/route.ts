import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { currentUser } from '../../../../src/server/auth';

/**
 * The design assistant's model call.
 *
 * The assistant asks Claude for *screens as HTML and CSS*, not for layers: the
 * canvas is HTML, and `src/lib/html-import.ts` turns markup into real layers by
 * laying it out in a browser and reading the result back — the same road the
 * MCP server's `write_html` takes. A model already knows how to write a login
 * screen in HTML; asking it for a proprietary layer tree would only make it
 * worse at the job. The route therefore returns markup and the browser does
 * the building, where the fonts and the layout engine are.
 */

export const maxDuration = 300;

const MODEL = 'claude-opus-5';

const Screen = z.object({
  name: z.string().describe('The screen name as it should appear as a frame name, e.g. "Login — Mobile".'),
  width: z.number().int().describe('The frame width in CSS px. 390 for phones, 1440 for desktop, 768 for tablets.'),
  html: z.string().describe('A body fragment whose single root element is the screen.'),
  css: z.string().describe('The stylesheet the fragment relies on. May be empty when styles are inline.'),
});

const Design = z.object({
  reply: z.string().describe('One or two sentences to the designer about what was made and why.'),
  screens: z.array(Screen).describe('The screens to build, in order. Empty when the request needs no new screens.'),
});

export type DesignScreen = z.infer<typeof Screen>;
export type DesignResponse = z.infer<typeof Design>;

const SYSTEM = `You are the design assistant inside Paperlike, a Figma-like design tool whose canvas is real HTML and CSS. Whatever you write is laid out by a browser and turned into editable layers: every flex container becomes an auto layout frame, every element that holds only text becomes a text layer, every <img> becomes an image layer. Designers then edit the result by hand, so what you produce must be a real, production-quality UI design — not a wireframe, not a sketch.

You answer with JSON: a short reply for the designer and a list of screens. Each screen is one HTML fragment plus its CSS.

Rules for the markup — they exist because of how it is read back:
- One root element per screen, sized exactly: style="width:<width>px" with a background colour set. Height flows from the content; give a phone screen at least 844px and a desktop screen at least 900px via min-height.
- Lay everything out with flexbox (display:flex, gap, padding, align-items, justify-content). Avoid CSS grid, floats and absolute positioning unless something genuinely overlaps (a badge on an avatar, a floating action button).
- Put text in its own leaf element (<p>, <h1>, <span>, <button> with text only). Never mix text and child elements in one container.
- Use system fonts: font-family Inter, system-ui, sans-serif. Set explicit font-size, font-weight, line-height and color on text.
- Icons: keep them simple. Use small inline <svg> with stroke="currentColor" and viewBox="0 0 24 24", or a coloured circle/square div. No icon fonts, no external icon libraries, no <script>.
- Pictures: use <img> with https://picsum.photos/seed/<word>/<w>/<h> for photos, or a gradient div as a placeholder. When the designer attached images and asks to use them, reference them as <img src="attachment:1">, <img src="attachment:2"> and so on, in the order attached.
- Colours as hex or rgba. Shadows via box-shadow. Corners via border-radius. Borders via border.
- No <html>, <head>, <body>, <style> or <script> tags inside html; put styles in css or inline.
- Class names should be meaningful (hero, nav, card, cta) because they become layer names. Add data-name="..." for a nicer layer name where a class would not read well.

Design quality:
- Follow modern product design conventions: clear hierarchy, 8px spacing rhythm, consistent radius scale, restrained palette with one accent, realistic copy (no lorem ipsum), realistic data.
- Respect the platform: phones are 390 wide with a status bar area, 16-20px side padding and a bottom tab bar or primary button; desktop screens are 1440 wide with a nav/sidebar and a content area.
- When asked for a flow or several screens, design each screen fully and keep them visually consistent (same palette, type scale, components).
- When asked for something small (a button, a card, a component), return a single screen sized to the component, with a transparent root background.
- If the request is a question rather than a design task, answer in reply and return no screens.`;

/** The key comes from the environment: the assistant works when it is set, and says so when it is not. */
const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function GET() {
  return Response.json({ ready: configured(), model: MODEL });
}

interface Attachment {
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

interface Body {
  prompt: string;
  attachments?: Attachment[];
  /** what is already on the page, so a follow-up can refer to it */
  context?: { screens?: string[]; selection?: string | null };
  history?: { role: 'user' | 'assistant'; text: string }[];
}

export async function POST(request: Request) {
  if (!(await currentUser())) return Response.json({ error: 'Sign in to use the assistant.' }, { status: 401 });
  if (!configured()) {
    return Response.json(
      { error: 'no-key', message: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) return Response.json({ error: 'Say what to design.' }, { status: 400 });

  const client = new Anthropic();

  const attachments = (body.attachments ?? []).slice(0, 6);
  const context: string[] = [];
  if (body.context?.screens?.length) {
    context.push(`Screens already on the page: ${body.context.screens.slice(0, 40).join(', ')}.`);
  }
  if (body.context?.selection) context.push(`The designer currently has "${body.context.selection}" selected.`);
  if (attachments.length) {
    context.push(
      `${attachments.length} image(s) are attached, numbered in order. Treat them as visual reference — style, palette, layout — and, when the designer asks to use a picture, place it with <img src="attachment:N">.`,
    );
  }

  const history: Anthropic.MessageParam[] = (body.history ?? [])
    .slice(-8)
    .filter((turn) => turn.text.trim())
    .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 4000) }));

  const content: Anthropic.ContentBlockParam[] = [
    ...attachments.map(
      (image): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: image.media_type, data: image.data },
      }),
    ),
    { type: 'text', text: [...context, prompt].join('\n\n') },
  ];

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 48000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [...history, { role: 'user', content }],
      output_config: { format: zodOutputFormat(Design) },
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return Response.json({ error: 'refused', message: 'The model declined that request.' }, { status: 422 });
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const parsed = Design.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return Response.json({ error: 'bad-output', message: 'The model answered in an unexpected shape.' }, { status: 502 });
    }
    return Response.json({
      ...parsed.data,
      usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
      truncated: message.stop_reason === 'max_tokens',
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: 'auth', message: 'The ANTHROPIC_API_KEY on the server was rejected.' }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'rate-limit', message: 'The model is rate limited — try again in a moment.' }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: 'api', message: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: 'server', message }, { status: 500 });
  }
}
