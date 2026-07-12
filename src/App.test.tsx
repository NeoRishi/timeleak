// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Phase 1 landing page', () => {
  it('shows only the locked Buildathon MVP message and primary action', () => {
    render(<App />)

    expect(screen.getByText('TimeLeak')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Show us your 24 hours. We find the time you can honestly reclaim and protect it for what matters beyond work.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find My TimeLeak' })).toBeInTheDocument()
    expect(screen.getByText('Buildathon MVP')).toBeInTheDocument()
    expect(screen.queryByText('Get started with Cloudflare')).not.toBeInTheDocument()
  })
})
