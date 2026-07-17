'use client';

import { useState, type InputHTMLAttributes } from 'react';

type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a20.8 20.8 0 014.06-5.94M9.9 4.24A10.94 10.94 0 0112 5c7 0 11 7 11 7a20.75 20.75 0 01-3.17 4.49M1 1l22 22" />
      <path d="M9.9 9.9a3 3 0 104.24 4.24" />
    </svg>
  );
}

/** Password field with show/hide toggle — use for API keys and other secrets. */
export function SecretInput({ className = '', disabled, ...props }: SecretInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="secret-input-wrap">
      <input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        autoComplete={props.autoComplete ?? 'off'}
        className={`input secret-input ${className}`.trim()}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className="secret-input-toggle"
        aria-label={visible ? 'Hide secret' : 'Show secret'}
        title={visible ? 'Hide secret' : 'Show secret'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
