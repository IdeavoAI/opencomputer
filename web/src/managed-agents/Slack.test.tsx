// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ManagedAgentChannel,
  ManagedAgentDeployment,
  ManagedSlackSetup,
} from './api'

const api = vi.hoisted(() => ({
  getManagedProject: vi.fn(),
  getManagedAgentDeployment: vi.fn(),
  getManagedAgentChannels: vi.fn(),
  findManagedSlackSetup: vi.fn(),
  startManagedSlackSetup: vi.fn(),
  authorizeManagedSlackSetup: vi.fn(),
  cancelManagedSlackSetup: vi.fn(),
  getManagedSlackSetup: vi.fn(),
  startManagedAgentSlack: vi.fn(),
  completeManagedAgentSlack: vi.fn(),
  bindManagedAgentSlackDestination: vi.fn(),
  disconnectManagedAgentSlack: vi.fn(),
  displayManagedAgentName: (agent: { id: string; name?: string }) =>
    agent.name || agent.id,
}))
vi.mock('./api', () => api)

const authorization = vi.hoisted(() => {
  const window = { close: vi.fn() }
  return {
    window,
    openAuthorizationWindow: vi.fn(() => window),
    navigateAuthorizationWindow: vi.fn(),
    launchAuthorizationWindow: vi.fn(
      async (authorizationUrl: () => Promise<string>) => {
        await authorizationUrl()
      },
    ),
  }
})
vi.mock('./authorization-window', () => ({
  openAuthorizationWindow: authorization.openAuthorizationWindow,
  navigateAuthorizationWindow: authorization.navigateAuthorizationWindow,
  launchAuthorizationWindow: authorization.launchAuthorizationWindow,
}))

// Imported after the mocks so the component sees the fakes.
const { ManagedProjectSlack } = await import('./Slack')

const project = {
  project: {
    id: 'prj_1',
    slug: 'slack-coder',
    name: 'slack-coder',
    environments: [
      {
        name: 'development',
        agentId: 'coder',
        activeDeploymentId: 'dep_coder',
        updatedAt: '2026-09-17T00:00:00.000Z',
      },
    ],
    agents: [{ id: 'coder', name: 'Coder' }],
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
  },
}

// The example's shape: no channel declaration, so the agent gets a dedicated
// app that receives mentions and direct messages.
const dedicatedDeployment: ManagedAgentDeployment = {
  id: 'dep_coder',
  agentId: 'coder',
  alias: 'development',
  channels: [],
  connections: [],
  createdAt: '2026-09-17T00:00:00.000Z',
  memory: [],
  projectDeployment: {
    id: 'pd_1',
    digest: 'digest',
    localAgentId: 'coder',
    agents: [{ localId: 'coder', agentId: 'coder' }],
    resources: { channels: [], channelRegistrations: [], schedules: [] },
  },
}

function setup(overrides: Partial<ManagedSlackSetup> = {}): ManagedSlackSetup {
  return {
    id: 'setup_1',
    requestKey: 'stored_0123456789',
    projectId: 'prj_1',
    agentId: 'coder',
    alias: 'development',
    channelId: 'slack',
    name: 'Patch',
    connectionId: 'channel_1',
    phase: 'prepared',
    actions: ['create', 'cancel'],
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  }
}

function connection(
  overrides: Partial<ManagedAgentChannel> = {},
): ManagedAgentChannel {
  return {
    id: 'channel_1',
    channel: 'slack',
    channelId: 'slack',
    agentId: 'coder',
    alias: 'development',
    appName: 'Patch',
    teamName: 'Acme',
    status: 'connected',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    destinations: [],
    agents: ['coder'],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function buttons(scope: ParentNode): string[] {
  return [...scope.querySelectorAll('button, a')].map(
    (element) => element.textContent?.trim() ?? '',
  )
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label,
  )
  if (!(match instanceof HTMLButtonElement))
    throw new Error(`Button not found: ${label}`)
  return match
}

async function settle(until: () => boolean, label: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (until()) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="search">{location.search}</span>
}

describe('ManagedProjectSlack', () => {
  let container: HTMLDivElement
  let root: Root
  let client: QueryClient

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    for (const fn of Object.values(api)) {
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
    }
    authorization.openAuthorizationWindow.mockClear()
    authorization.navigateAuthorizationWindow.mockClear()
    authorization.launchAuthorizationWindow.mockClear()
    authorization.window.close.mockClear()
    api.getManagedProject.mockResolvedValue(project)
    api.getManagedAgentDeployment.mockResolvedValue(dedicatedDeployment)
    api.getManagedAgentChannels.mockResolvedValue([])
    api.findManagedSlackSetup.mockResolvedValue(null)
  })

  afterEach(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
    document.body.replaceChildren()
  })

  function render(
    path = '/projects/prj_1/connections?environment=development',
  ) {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <ManagedProjectSlack projectId="prj_1" environment="development" />
            <LocationProbe />
          </MemoryRouter>
        </QueryClientProvider>,
      )
    })
  }

  const text = () => container.textContent ?? ''

  it('offers automatic setup for the dedicated app and names the receiving agent', async () => {
    render()
    await settle(() => text().includes('Create Slack bot'), 'the slot')

    expect(text()).toContain('Mentions and direct messages go to Coder')
    expect(buttons(container)).toContain('Set up manually')
    expect(api.findManagedSlackSetup).toHaveBeenCalledWith({
      agentId: 'coder',
      alias: 'development',
      channelId: undefined,
    })
  })

  it('resumes a stored setup after reload from its phase and actions', async () => {
    api.findManagedSlackSetup.mockResolvedValue(
      setup({
        phase: 'app_created',
        app: { id: 'A1', name: 'Patch' },
        actions: ['authorize', 'cancel'],
      }),
    )
    api.authorizeManagedSlackSetup.mockResolvedValue({
      authorizationUrl: 'https://slack.com/oauth/v2/authorize?state=x',
      expiresAt: '2026-09-17T00:10:00.000Z',
    })
    render()
    await settle(() => text().includes('Approve its installation'), 'resume')

    expect(buttons(container)).toContain('Authorize in Slack')
    expect(buttons(container)).toContain('Cancel setup')
    expect(buttons(container)).not.toContain('Create Slack bot')
    expect(api.startManagedSlackSetup).not.toHaveBeenCalled()

    act(() => button(container, 'Authorize in Slack').click())
    await settle(
      () => api.authorizeManagedSlackSetup.mock.calls.length > 0,
      'authorization',
    )
    expect(authorization.launchAuthorizationWindow).toHaveBeenCalledTimes(1)
    expect(api.authorizeManagedSlackSetup).toHaveBeenCalledWith('setup_1')
    await settle(() => text().includes('Waiting for Slack…'), 'waiting')
  })

  it('submits once per click with one request key, and retries a rejected token under the same key', async () => {
    render()
    await settle(() => text().includes('Create Slack bot'), 'the slot')
    act(() => button(container, 'Create Slack bot').click())
    await settle(
      () => document.body.querySelector('#managed-slack-setup-token') !== null,
      'the dialog',
    )
    const tokenInput = document.body.querySelector(
      '#managed-slack-setup-token',
    ) as HTMLInputElement
    const dialog = tokenInput.closest('[role="dialog"]') as HTMLElement
    expect(tokenInput.type).toBe('password')
    const nameInput = dialog.querySelector(
      '#managed-slack-setup-name',
    ) as HTMLInputElement
    expect(nameInput.value).toBe('Coder')
    act(() => typeInto(nameInput, 'Patch'))
    act(() => typeInto(tokenInput, 'xoxe.xoxp-first'))

    const first = deferred<ManagedSlackSetup>()
    api.startManagedSlackSetup.mockReturnValueOnce(first.promise)
    const form = tokenInput.closest('form')!
    act(() => button(dialog, 'Create Slack bot').click())
    await settle(
      () => api.startManagedSlackSetup.mock.calls.length === 1,
      'the first submit',
    )
    // A second submit while the first is in flight does nothing.
    act(() => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    expect(api.startManagedSlackSetup).toHaveBeenCalledTimes(1)
    expect(button(dialog, 'Creating…').disabled).toBe(true)
    // The window is opened inside the click, before anything asynchronous.
    expect(authorization.openAuthorizationWindow).toHaveBeenCalledTimes(1)

    const firstCall = api.startManagedSlackSetup.mock.calls[0][0] as {
      requestKey: string
      configurationToken: string
      name: string
    }
    expect(firstCall.requestKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(firstCall).toMatchObject({
      agentId: 'coder',
      alias: 'development',
      name: 'Patch',
      configurationToken: 'xoxe.xoxp-first',
    })

    await act(async () => {
      first.resolve(
        setup({
          requestKey: firstCall.requestKey,
          error: {
            code: 'slack_configuration_token_invalid',
            message: 'invalid_auth',
            recoverable: true,
            at: '2026-09-17T00:01:00.000Z',
          },
        }),
      )
      await first.promise
    })
    await settle(
      () =>
        dialog.textContent?.includes(
          'Slack rejected the configuration token',
        ) ?? false,
      'the rejection',
    )
    expect(authorization.window.close).toHaveBeenCalledTimes(1)
    expect(authorization.navigateAuthorizationWindow).not.toHaveBeenCalled()
    expect(tokenInput.value).toBe('')

    api.startManagedSlackSetup.mockResolvedValueOnce(
      setup({
        requestKey: firstCall.requestKey,
        phase: 'app_created',
        app: { id: 'A1', name: 'Patch' },
        actions: ['authorize', 'cancel'],
      }),
    )
    api.authorizeManagedSlackSetup.mockResolvedValue({
      authorizationUrl: 'https://slack.com/oauth/v2/authorize?state=fresh',
      expiresAt: '2026-09-17T00:12:00.000Z',
    })
    act(() => typeInto(tokenInput, 'xoxe.xoxp-second'))
    act(() => button(dialog, 'Try another token').click())
    await settle(
      () => authorization.navigateAuthorizationWindow.mock.calls.length > 0,
      'the consent page',
    )
    expect(api.startManagedSlackSetup).toHaveBeenCalledTimes(2)
    const secondCall = api.startManagedSlackSetup.mock.calls[1][0] as {
      requestKey: string
      configurationToken: string
    }
    expect(secondCall.requestKey).toBe(firstCall.requestKey)
    expect(secondCall.configurationToken).toBe('xoxe.xoxp-second')
    expect(authorization.navigateAuthorizationWindow).toHaveBeenCalledWith(
      authorization.window,
      'https://slack.com/oauth/v2/authorize?state=fresh',
    )
    await settle(
      () => document.body.querySelector('#managed-slack-setup-token') === null,
      'the dialog to close',
    )
    expect(text()).toContain('Approve its installation')
  })

  it('renders a specific next action for each error state', async () => {
    const cases: Array<{
      setup: ManagedSlackSetup
      title: string
      offered: string[]
      withheld: string[]
    }> = [
      {
        setup: setup({
          error: {
            code: 'slack_configuration_token_expired',
            message: 'token_expired',
            recoverable: true,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'The configuration token expired',
        offered: ['Try another token', 'Cancel setup'],
        withheld: ['Authorize in Slack', 'Retry'],
      },
      {
        setup: setup({ phase: 'creating', actions: [] }),
        title: 'Creating the Slack app…',
        offered: [],
        withheld: ['Create Slack bot', 'Cancel setup', 'Retry'],
      },
      {
        setup: setup({
          phase: 'creation_uncertain',
          actions: ['manual', 'cancel'],
          error: {
            code: 'slack_creation_uncertain',
            message: 'timeout',
            recoverable: false,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'The result of app creation was lost',
        offered: ['Open your Slack apps', 'Set up manually', 'Cancel setup'],
        withheld: [
          'Create Slack bot',
          'Try another token',
          'Retry',
          'Authorize in Slack',
        ],
      },
      {
        setup: setup({
          phase: 'app_created',
          app: { id: 'A1', name: 'Patch' },
          actions: ['authorize', 'cancel'],
          error: {
            code: 'slack_authorization_denied',
            message: 'access_denied',
            recoverable: true,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'Installation was declined',
        offered: ['Authorize again', 'Cancel setup'],
        withheld: ['Create Slack bot'],
      },
      {
        setup: setup({
          phase: 'app_created',
          app: { id: 'A1', name: 'Patch' },
          actions: ['authorize', 'cancel'],
          error: {
            code: 'slack_scope_missing',
            message: 'missing chat:write',
            recoverable: true,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'A declared permission is missing',
        offered: ['Authorize again'],
        withheld: ['Create Slack bot'],
      },
      {
        setup: setup({
          phase: 'app_created',
          app: { id: 'A1', name: 'Patch' },
          workspace: { id: 'T1', name: 'Acme' },
          actions: ['authorize', 'cancel'],
          error: {
            code: 'slack_workspace_mismatch',
            message: 'team mismatch',
            recoverable: true,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'Installed to a different workspace',
        offered: ['Authorize again'],
        withheld: [],
      },
      {
        setup: setup({
          phase: 'app_created',
          app: { id: 'A1', name: 'Patch' },
          actions: ['cancel'],
          error: {
            code: 'slack_setup_superseded',
            message: 'superseded',
            recoverable: false,
            at: '2026-09-17T00:00:00.000Z',
          },
        }),
        title: 'Another connection change completed first',
        offered: ['Cancel setup'],
        withheld: ['Authorize again', 'Authorize in Slack'],
      },
      {
        setup: setup({ phase: 'exchanging', actions: [] }),
        title: 'Confirming the installation…',
        offered: [],
        withheld: ['Authorize in Slack', 'Cancel setup'],
      },
    ]
    for (const testCase of cases) {
      client.clear()
      api.findManagedSlackSetup.mockResolvedValue(testCase.setup)
      render()
      await settle(() => text().includes(testCase.title), testCase.title)
      const offered = buttons(container)
      for (const label of testCase.offered) expect(offered).toContain(label)
      for (const label of testCase.withheld)
        expect(offered).not.toContain(label)
      if (testCase.setup.phase === 'creation_uncertain') {
        expect(text()).toContain('Check your Slack app list')
        expect(
          [...container.querySelectorAll('a')].some(
            (anchor) => anchor.href === 'https://api.slack.com/apps',
          ),
        ).toBe(true)
      }
      act(() => root.unmount())
      root = createRoot(container)
    }
  })

  it('shows the outcome brought back from Slack and clears it from the URL', async () => {
    api.findManagedSlackSetup.mockResolvedValue(
      setup({
        phase: 'app_created',
        app: { id: 'A1', name: 'Patch' },
        actions: ['authorize', 'cancel'],
        error: {
          code: 'slack_authorization_denied',
          message: 'access_denied',
          recoverable: true,
          at: '2026-09-17T00:00:00.000Z',
        },
      }),
    )
    render(
      '/projects/prj_1/connections?environment=development&slack=authorization_denied&setup=setup_1',
    )
    await settle(
      () => container.querySelector('[role="status"]') !== null,
      'the banner',
    )
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Installation was declined',
    )
    await settle(
      () =>
        container.querySelector('[data-testid="search"]')?.textContent ===
        '?environment=development',
      'the URL to be cleared',
    )
    act(() =>
      (
        container.querySelector(
          'button[aria-label="Dismiss"]',
        ) as HTMLButtonElement
      ).click(),
    )
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('keeps connected credentials distinct from the first received message', async () => {
    api.getManagedAgentChannels.mockResolvedValue([connection()])
    render()
    await settle(
      () => text().includes('Waiting for the first message'),
      'waiting',
    )
    expect(text()).toContain('invite @Patch')
    expect(buttons(container)).not.toContain('Create Slack bot')
    expect(buttons(container)).toContain('Disconnect')
    expect(api.findManagedSlackSetup).not.toHaveBeenCalled()

    act(() => root.unmount())
    root = createRoot(container)
    client.clear()
    api.getManagedAgentChannels.mockResolvedValue([
      connection({ verifiedAt: '2026-09-17T00:05:00.000Z' }),
    ])
    render()
    await settle(
      () => text().includes('Listening for Slack events'),
      'verified',
    )
    expect(text()).not.toContain('Waiting for the first message')
  })
})
