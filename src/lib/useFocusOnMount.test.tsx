import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFocusOnMount } from './useFocusOnMount'

/** 最小宿主：一个 `tabIndex={-1}` 的容器，正是页面正文的样子。 */
function Probe() {
  const ref = useFocusOnMount<HTMLDivElement>()
  return <div ref={ref} tabIndex={-1} data-testid="target" />
}

describe('useFocusOnMount', () => {
  it('挂载后焦点落在容器上', () => {
    render(<Probe />)

    expect(screen.getByTestId('target')).toHaveFocus()
  })
})
