import * as SliderPrimitive from '@radix-ui/react-slider'
import './ThumbSlider.css'

interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  /** Fires continuously while dragging — use to keep a live readout in sync. */
  onChange: (value: number) => void
  /** Fires once when the drag/keypress settles — use to commit the value. */
  onCommit?: (value: number) => void
  label?: string
  disabled?: boolean
}

export function ThumbSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  label,
  disabled = false,
}: SliderProps) {
  return (
    <div className="thumb-slider">
      {label && (
        <div className="thumb-slider__label">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      )}

      <SliderPrimitive.Root
        className="thumb-slider__root"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(values) => onChange(values[0])}
        onValueCommit={(values) => onCommit?.(values[0])}
      >
        <SliderPrimitive.Track className="thumb-slider__track">
          <SliderPrimitive.Range className="thumb-slider__range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="thumb-slider__thumb"
          aria-label={label || 'Slider'}
        />
      </SliderPrimitive.Root>
    </div>
  )
}

export default ThumbSlider
