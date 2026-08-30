'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './ui/Icons';
import type { FormState } from '../server/actions';

export function AuthForm({
  action,
  title,
  subtitle,
  submitLabel,
  footer,
  withName = false,
  next = null,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  title: string;
  subtitle: string;
  submitLabel: string;
  footer: ReactNode;
  withName?: boolean;
  /** where to land afterwards — the file link that bounced them here */
  next?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form
        action={formAction}
        style={{
          width: 320,
          background: 'var(--color-panel)',
          borderRadius: 12,
          padding: 24,
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Icon.Logo />
          <span style={{ fontWeight: 500 }}>Paperlike</span>
        </div>

        <h1 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>{title}</h1>
        <p style={{ margin: '0 0 18px', color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>{subtitle}</p>

        {next && <input type="hidden" name="next" value={next} />}

        {withName && <Field label="Name" name="name" type="text" autoComplete="name" />}
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={withName ? 'new-password' : 'current-password'}
        />

        {state?.error && (
          <p role="alert" style={{ margin: '12px 0 0', color: '#C0392B' }}>
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{
            width: '100%',
            height: 32,
            marginTop: 16,
            border: 0,
            borderRadius: 6,
            background: '#111',
            color: '#fff',
            fontWeight: 500,
            cursor: 'default',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Working…' : submitLabel}
        </button>

        <p style={{ margin: '14px 0 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>{footer}</p>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', marginBottom: 4, color: 'var(--color-ink-muted)' }}>{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        style={{
          width: '100%',
          height: 30,
          padding: '0 8px',
          border: 0,
          borderRadius: 5,
          background: 'var(--color-control)',
          boxShadow: 'var(--shadow-control)',
          outline: 'none',
        }}
      />
    </label>
  );
}
