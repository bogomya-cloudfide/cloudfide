import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('requests under /api with a JSON content type and parses the body', async () => {
  const fetchMock = stubFetch([{ id: 1 }])
  await expect(request('/todos', { method: 'POST' })).resolves.toEqual([
    { id: 1 },
  ])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
})

it('lets callers override headers', async () => {
  const fetchMock = stubFetch({})
  await request('/x', { headers: { 'Content-Type': 'text/plain', 'X-A': '1' } })
  expect(fetchMock.mock.calls[0][1].headers).toEqual({
    'Content-Type': 'text/plain',
    'X-A': '1',
  })
})

it('returns undefined for 204 responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  )
  await expect(
    request('/todos/1', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('throws a validation message on 422', async () => {
  stubFetch({ detail: [] }, 422)
  await expect(request('/todos')).rejects.toThrow(/Check the task details/)
})

it('throws the server detail when it is a string', async () => {
  stubFetch({ detail: 'Task not found' }, 404)
  await expect(request('/todos/9')).rejects.toThrow('Task not found')
})

it('throws a generic message when the error body has no string detail', async () => {
  stubFetch({ detail: { a: 1 } }, 500)
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('throws a generic message when the error body is not JSON', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('oops', { status: 500 })),
  )
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('reports a connection problem when fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException('aborted', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})
