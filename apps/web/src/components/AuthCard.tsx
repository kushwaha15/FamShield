import type { ReactNode } from 'react';

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <section className="mx-auto max-w-xl px-5 py-12 sm:px-8 sm:py-16">
      <div className="rounded-card border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
          FamShield account
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy">{title}</h1>
        <p className="mt-3 leading-6 text-slate-600">{description}</p>
        <div className="mt-7">{children}</div>
        {footer && <div className="mt-6 border-t border-slate-100 pt-5">{footer}</div>}
      </div>
    </section>
  );
}

interface FormFeedbackProps {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
}

export function FormFeedback({ kind, children }: FormFeedbackProps) {
  const styles = {
    error: 'bg-red-50 text-red-800',
    success: 'bg-emerald-50 text-emerald-800',
    info: 'bg-brand-mist text-brand-navy',
  };

  return (
    <p
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={`rounded-xl px-4 py-3 text-sm ${styles[kind]}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
