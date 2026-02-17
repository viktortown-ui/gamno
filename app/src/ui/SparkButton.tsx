import { useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'

type SparkButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export function SparkButton({ className = '', onClick, children, ...props }: SparkButtonProps) {
  const [spark, setSpark] = useState(0)

  return (
    <button
      {...props}
      className={`button button--spark ${className}`.trim()}
      onClick={(event) => {
        setSpark((value) => value + 1)
        onClick?.(event)
      }}
    >
      <span>{children}</span>
      <span key={spark} className="button-spark" aria-hidden="true" />
    </button>
  )
}
