import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet';

export function Button({ variant = 'primary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={['button', `button--${variant}`, className].filter(Boolean).join(' ')} {...rest} />;
}
