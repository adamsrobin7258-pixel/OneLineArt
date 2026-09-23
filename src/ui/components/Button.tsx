import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet' | 'ghost' | 'danger';

/** primary = the one main action; quiet = secondary; ghost = low-emphasis; danger = destructive. */
export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={['button', `button--${variant}`, className].filter(Boolean).join(' ')} {...rest} />;
}
