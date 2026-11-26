import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { GlobalStyles } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))

function Probe() {
  const client = useQueryClient()
  return <p>{client === queryClient ? 'default' : 'custom'}</p>
}

it('renders children with global styles and the default query client', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('default')).toBeInTheDocument()
  expect(GlobalStyles).toHaveBeenCalled()
})

it('uses a provided query client', () => {
  render(
    <AppProviders client={new QueryClient()}>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('custom')).toBeInTheDocument()
})
