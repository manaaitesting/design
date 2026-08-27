'use client';

import { useEffect, useRef } from 'react';
import { ShaderInstance } from '../webgl/renderer';
import { SHADER_BY_ID } from '../webgl/shaders';

/**
 * Mounts a WebGL canvas for one shader node.
 *
 * Off-screen instances stop drawing via IntersectionObserver, so a board with
 * twenty shaders only pays for the ones you can actually see.
 */
export function ShaderSurface({
  shaderId,
  params,
}: {
  shaderId: string;
  params: Record<string, number | string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ShaderInstance | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const def = SHADER_BY_ID.get(shaderId);
    if (!canvas || !def) return;

    let instance: ShaderInstance;
    try {
      instance = new ShaderInstance(canvas, def, params);
    } catch (error) {
      console.error(`[shader:${shaderId}]`, error);
      return;
    }
    instanceRef.current = instance;

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      instance.resize(width, height);
    });
    resize.observe(canvas);

    const visibility = new IntersectionObserver(([entry]) => {
      instance.visible = entry.isIntersecting;
    });
    visibility.observe(canvas);

    return () => {
      resize.disconnect();
      visibility.disconnect();
      instance.destroy();
      instanceRef.current = null;
    };
    // params are pushed imperatively below — recreating the program on every
    // slider tick would recompile the shader mid-drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shaderId]);

  useEffect(() => {
    if (instanceRef.current) instanceRef.current.params = params;
  }, [params]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', borderRadius: 'inherit' }}
    />
  );
}
