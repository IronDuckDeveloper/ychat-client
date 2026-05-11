import type { ReactNode } from 'react'

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

function Button({ children, onClick, type = 'button' }: ButtonProps) {
  return (
    <button type={type} className="app-button" onClick={onClick}>
      {children}
    </button>
  )
}

export default Button
