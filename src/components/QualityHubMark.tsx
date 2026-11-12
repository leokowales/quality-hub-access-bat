import type { SVGProps } from 'react'

type QualityHubMarkProps = SVGProps<SVGSVGElement> & { size?: number }

export default function QualityHubMark({ size = 28, ...props }: QualityHubMarkProps) {
  return <svg width={size} height={size} viewBox="0 0 240 176" aria-hidden="true" {...props}>
    <use href="/qualityhub-mark.svg#mark" />
  </svg>
}
