type InputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function Input({ value, onChange, placeholder }: InputProps) {
  return (
    <input
      className="app-input"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export default Input
