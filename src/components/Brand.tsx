import '../styles/base/Brand.css'
import QualityHubMark from './QualityHubMark'

type BrandProps = {
  variant?: 'light' | 'dark'
}

function Brand({ variant = 'light' }: BrandProps) {
  return (
    <div className={`brand brand-${variant}`}>
      <QualityHubMark size={34} />
      <span className="brand-name">
        Quality <span>Hub</span>
      </span>
    </div>
  )
}

export default Brand
