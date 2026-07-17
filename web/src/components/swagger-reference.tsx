'use client';

import { useEffect, useRef, useState } from 'react';

// Interactive API reference: renders Swagger UI from the API's OpenAPI spec, with
// "Try it out" + an Authorize button (bearer sk-hds-… key). Loaded from a CDN to
// avoid bundling a heavy dependency. The API's CORS allows the browser to call it.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8791';
const SWAGGER_VERSION = '5.17.14';

export function SwaggerReference() {
  const mounted = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      const SwaggerUIBundle = (window as any).SwaggerUIBundle;
      if (!SwaggerUIBundle) {
        setErr('Failed to load Swagger UI');
        return;
      }
      try {
        SwaggerUIBundle({
          url: `${API_URL}/openapi.json`,
          domNode: document.getElementById('swagger-root'),
          deepLinking: true,
          tryItOutEnabled: true,
          persistAuthorization: true,
          presets: [SwaggerUIBundle.presets.apis],
          requestInterceptor: (req: any) => {
            if (req.url.startsWith('/')) req.url = API_URL + req.url;
            return req;
          },
        });
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    script.onerror = () => setErr('Failed to load Swagger UI bundle from CDN');
    document.body.appendChild(script);
  }, []);

  return (
    <>
      {err && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn’t load the interactive viewer ({err}). The raw spec is at{' '}
          <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer" className="underline">
            {API_URL}/openapi.json
          </a>
          .
        </div>
      )}
      <div className="card overflow-hidden bg-white p-2">
        <div id="swagger-root" />
      </div>
    </>
  );
}
