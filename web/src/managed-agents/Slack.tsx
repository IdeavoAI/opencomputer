import { useEffect, useState, type FormEvent } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Bot,
  Check,
  CircleAlert,
  ExternalLink,
  Loader2,
  MessageSquare,
  TriangleAlert,
  X,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Field, Input } from '@/components/form'
import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { notifyError, notifySuccess } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  authorizeManagedSlackSetup,
  cancelManagedSlackSetup,
  displayManagedAgentName,
  findManagedSlackSetup,
  getManagedAgentChannels,
  getManagedAgentDeployment,
  getManagedProject,
  startManagedSlackSetup,
  type ManagedSlackSetup,
  type ManagedSlackSetupTarget,
} from './api'
import {
  launchAuthorizationWindow,
  navigateAuthorizationWindow,
  openAuthorizationWindow,
} from './authorization-window'
import {
  DEDICATED_SLACK_CHANNEL_ID,
  SLACK_APPS_URL,
  SLACK_CONFIGURATION_TOKEN_STEPS,
  SLACK_RETURN_COPY,
  describeSlackSetup,
  describeSlackVerification,
  newSlackSetupRequestKey,
  slackReturnFromSearch,
  slackSlotsForEnvironment,
  withoutSlackReturn,
  type SlackReturn,
  type SlackSlot,
} from './slack-setup'
import { ManagedSlackWizard } from './SlackWizard'

type Environment = 'development' | 'production'

/**
 * Which setup state Slack's consent page was opened for. The page is polled
 * while that state holds; any recorded outcome changes the phase or the
 * error and ends the wait by itself.
 */
type AuthorizationLaunch = { setupId: string; errorAt: string }

function launchFor(setup: ManagedSlackSetup): AuthorizationLaunch {
  return { setupId: setup.id, errorAt: setup.error?.at ?? '' }
}

function awaitingAuthorizationFor(
  launch: AuthorizationLaunch | undefined,
  setup: ManagedSlackSetup | null | undefined,
): boolean {
  return Boolean(
    launch &&
    setup &&
    setup.id === launch.setupId &&
    setup.phase === 'app_created' &&
    (setup.error?.at ?? '') === launch.errorAt,
  )
}

const setupQueryKey = (target: ManagedSlackSetupTarget) => [
  'managed-slack-setup',
  target.agentId,
  target.alias,
  target.channelId ?? DEDICATED_SLACK_CHANNEL_ID,
]

/**
 * Project → Connections → Slack. One row per Slack slot of the environment's
 * active deployments: a declared channel with the agents that consume it, or
 * the dedicated app of an agent that declares none. Automatic setup creates
 * and installs the app; the existing wizard stays as "Set up manually" and
 * keeps managing a connected bot (credentials, destinations, disconnect).
 */
export function ManagedProjectSlack({
  projectId,
  environment,
}: {
  projectId: string
  environment: Environment
}) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // The outcome Slack's consent page brought us back with. Read once, then
  // removed from the URL so a reload does not announce it again.
  const [returned, setReturned] = useState<SlackReturn | undefined>(() =>
    slackReturnFromSearch(searchParams.toString()),
  )
  useEffect(() => {
    if (!slackReturnFromSearch(searchParams.toString())) return
    void queryClient.invalidateQueries({ queryKey: ['managed-agent-channels'] })
    void queryClient.invalidateQueries({ queryKey: ['managed-slack-setup'] })
    setSearchParams(
      new URLSearchParams(withoutSlackReturn(searchParams.toString())),
      { replace: true },
    )
  }, [queryClient, searchParams, setSearchParams])

  const project = useQuery({
    queryKey: ['managed-project', projectId],
    queryFn: () => getManagedProject(projectId),
  })
  const deploymentIds = [
    ...new Set(
      (project.data?.project.environments ?? [])
        .filter((candidate) => candidate.name === environment)
        .flatMap((candidate) =>
          candidate.activeDeploymentId ? [candidate.activeDeploymentId] : [],
        ),
    ),
  ]
  const deployments = useQueries({
    queries: deploymentIds.map((deploymentId) => ({
      queryKey: ['managed-agent-deployment', deploymentId],
      queryFn: () => getManagedAgentDeployment(deploymentId),
    })),
  })
  const channels = useQuery({
    queryKey: ['managed-agent-channels'],
    queryFn: getManagedAgentChannels,
  })
  const loading =
    project.isLoading ||
    channels.isLoading ||
    deployments.some((deployment) => deployment.isLoading)
  const failed =
    project.isError ||
    channels.isError ||
    deployments.some((deployment) => deployment.isError)
  const agentNames = new Map(
    (project.data?.project.agents ?? []).map((agent) => [
      agent.id,
      displayManagedAgentName(agent),
    ]),
  )
  const slots = project.data
    ? slackSlotsForEnvironment({
        project: project.data.project,
        deployments: deployments.flatMap((deployment) =>
          deployment.data ? [deployment.data] : [],
        ),
        channels: channels.data ?? [],
        environment,
      })
    : []

  return (
    <Panel className="overflow-hidden">
      <PanelHeader>
        <div>
          <PanelTitle>Slack</PanelTitle>
          <PanelDescription className="mt-1 max-w-2xl">
            A dedicated Slack app per channel and environment. OpenComputer
            creates and installs it from the capabilities declared in code; you
            approve the installation in Slack.
          </PanelDescription>
        </div>
      </PanelHeader>
      {returned ? (
        <ReturnBanner
          returned={returned}
          onDismiss={() => setReturned(undefined)}
        />
      ) : null}
      {loading ? (
        <PanelContent className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading Slack status…
        </PanelContent>
      ) : failed ? (
        <EmptyState
          icon={MessageSquare}
          title="Slack status is temporarily unavailable"
          description="Try loading the project again."
          action={
            <Button
              variant="outline"
              onClick={() => {
                void project.refetch()
                void channels.refetch()
                for (const deployment of deployments) void deployment.refetch()
              }}
            >
              Try again
            </Button>
          }
        />
      ) : slots.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={`Nothing is deployed to ${environment}`}
          description="Deploy an agent to this environment to connect Slack."
        />
      ) : (
        slots.map((slot) => (
          <SlackSlotRow
            key={slot.key}
            slot={slot}
            environment={environment}
            agentNames={agentNames}
            highlighted={
              returned?.setupId !== undefined && returned.result !== 'connected'
            }
          />
        ))
      )}
    </Panel>
  )
}

function ReturnBanner({
  returned,
  onDismiss,
}: {
  returned: SlackReturn
  onDismiss: () => void
}) {
  const copy = SLACK_RETURN_COPY[returned.result]
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 border-b px-5 py-4',
        copy.tone === 'success'
          ? 'bg-status-running-bg/40'
          : 'bg-status-error-bg/40',
      )}
    >
      {copy.tone === 'success' ? (
        <Check className="text-status-running mt-0.5 size-5" aria-hidden />
      ) : (
        <TriangleAlert
          className="text-status-error mt-0.5 size-5"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-muted-foreground text-sm">{copy.description}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  )
}

function SlackSlotRow({
  slot,
  environment,
  agentNames,
  highlighted,
}: {
  slot: SlackSlot
  environment: Environment
  agentNames: Map<string, string>
  highlighted: boolean
}) {
  const consumerNames = slot.consumers.map(
    (agentId) => agentNames.get(agentId) ?? agentId,
  )
  const agentName = agentNames.get(slot.agentId) ?? slot.agentId
  return (
    <ManagedSlackWizard
      agentId={slot.agentId}
      alias={environment}
      agentName={agentName}
      channelName={slot.dedicated ? undefined : slot.name}
      channelId={slot.channelId}
      connection={slot.connection}
      destinations={slot.destinations}
      consumers={
        slot.dedicated
          ? `Mentions and direct messages go to ${consumerNames.join(', ')}`
          : `Consumed by ${consumerNames.join(', ')}`
      }
      setup={({ beginManual }) => (
        <SlackAutomaticSetup
          slot={slot}
          environment={environment}
          agentName={agentName}
          onSetUpManually={beginManual}
          highlighted={highlighted}
        />
      )}
    />
  )
}

/**
 * The automatic path for one slot. The setup record lives on the platform
 * and is rediscovered by target, so a reload resumes from its phase; nothing
 * about it is kept in the browser.
 */
function SlackAutomaticSetup({
  slot,
  environment,
  agentName,
  onSetUpManually,
  highlighted,
}: {
  slot: SlackSlot
  environment: Environment
  agentName: string
  onSetUpManually: () => void
  highlighted: boolean
}) {
  const queryClient = useQueryClient()
  const target: ManagedSlackSetupTarget = {
    agentId: slot.agentId,
    alias: environment,
    channelId: slot.channelId,
  }
  const queryKey = setupQueryKey(target)
  const connection = slot.connection
  const connected = connection?.status === 'connected'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [authorizationLaunch, setAuthorizationLaunch] =
    useState<AuthorizationLaunch>()

  const setupQuery = useQuery({
    queryKey,
    queryFn: () => findManagedSlackSetup(target),
    enabled: !connected,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const current = query.state.data
      return current?.phase === 'creating' ||
        current?.phase === 'exchanging' ||
        awaitingAuthorizationFor(authorizationLaunch, current)
        ? 2_000
        : false
    },
  })
  const setup = connected ? undefined : setupQuery.data
  const awaitingAuthorization = awaitingAuthorizationFor(
    authorizationLaunch,
    setup,
  )
  useEffect(() => {
    if (!authorizationLaunch) return
    // Authorization links last ten minutes; stop polling after that.
    const timeout = window.setTimeout(
      () => setAuthorizationLaunch(undefined),
      10 * 60_000,
    )
    return () => window.clearTimeout(timeout)
  }, [authorizationLaunch])

  // A connected bot has not proven itself until a real message arrives.
  const verificationPending = Boolean(
    connected && !connection.verifiedAt && !connection.verificationError,
  )
  useEffect(() => {
    if (!verificationPending) return
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: ['managed-agent-channels'],
      })
    }, 2_000)
    return () => window.clearInterval(interval)
  }, [queryClient, verificationPending])

  const authorize = useMutation({
    mutationFn: (current: ManagedSlackSetup) =>
      launchAuthorizationWindow(async () => {
        const { authorizationUrl } = await authorizeManagedSlackSetup(
          current.id,
        )
        return authorizationUrl
      }),
    onSuccess: (_result, current) => setAuthorizationLaunch(launchFor(current)),
    onError: (error) =>
      notifyError("Couldn't start the Slack installation.", error),
  })
  const cancel = useMutation({
    mutationFn: (setupId: string) => cancelManagedSlackSetup(setupId),
    onSuccess: () => {
      setConfirmCancel(false)
      queryClient.setQueryData(queryKey, null)
      void queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({
        queryKey: ['managed-agent-channels'],
      })
      notifySuccess(
        'Slack setup cancelled.',
        'If Slack already created the app, it is still in your Slack app list.',
      )
    },
    onError: (error) => notifyError("Couldn't cancel the Slack setup.", error),
  })

  if (connected && connection) {
    if (!verificationPending) return null
    const verification = describeSlackVerification(
      connection,
      connection.appName || agentName,
    )
    return (
      <div className="flex items-start gap-3 border-t px-5 py-4">
        <Loader2
          className="text-muted-foreground mt-0.5 size-5 animate-spin"
          aria-hidden
        />
        <div>
          <p className="text-sm font-medium">{verification.title}</p>
          <p className="text-muted-foreground text-sm">
            {verification.description}
          </p>
        </div>
      </div>
    )
  }

  const view = describeSlackSetup(setup)
  const actions = setup?.actions ?? ['create']
  const busy = view.tone === 'pending' || setupQuery.isLoading
  const showCreate =
    view.primary?.action === 'create' && actions.includes('create')
  const showAuthorize =
    view.primary?.action === 'authorize' && actions.includes('authorize')
  const uncertain = setup?.phase === 'creation_uncertain'
  const Icon =
    view.tone === 'error'
      ? TriangleAlert
      : view.tone === 'success'
        ? Check
        : busy
          ? Loader2
          : Bot

  return (
    <div
      className={cn(
        'space-y-3 border-t px-5 py-4',
        highlighted && view.tone === 'error' && 'bg-status-error-bg/20',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 size-5 shrink-0',
            view.tone === 'error'
              ? 'text-status-error'
              : view.tone === 'success'
                ? 'text-status-running'
                : 'text-muted-foreground',
            busy && 'animate-spin',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {setupQuery.isLoading
              ? 'Checking for a setup in progress…'
              : view.title}
          </p>
          {!setupQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">{view.description}</p>
          ) : null}
          {setup?.error?.pointer ? (
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {setup.error.pointer}
            </p>
          ) : null}
        </div>
      </div>
      {!setupQuery.isLoading ? (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          {showCreate ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              {view.primary!.label}
            </Button>
          ) : null}
          {showAuthorize && setup ? (
            <Button
              size="sm"
              disabled={authorize.isPending || awaitingAuthorization}
              onClick={() => authorize.mutate(setup)}
            >
              {authorize.isPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {awaitingAuthorization
                ? 'Waiting for Slack…'
                : view.primary!.label}
            </Button>
          ) : null}
          {uncertain ? (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={SLACK_APPS_URL} target="_blank" rel="noreferrer">
                  Open your Slack apps <ExternalLink />
                </a>
              </Button>
              {actions.includes('manual') ? (
                <Button size="sm" variant="outline" onClick={onSetUpManually}>
                  Set up manually
                </Button>
              ) : null}
            </>
          ) : null}
          {setup && actions.includes('cancel') ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel setup
            </Button>
          ) : null}
        </div>
      ) : null}

      {dialogOpen ? (
        <SlackSetupDialog
          target={target}
          setup={setup ?? undefined}
          defaultName={setup?.name ?? agentName}
          slotLabel={
            slot.dedicated
              ? `${agentName} · ${environment}`
              : `${slot.name} · ${environment}`
          }
          onClose={() => setDialogOpen(false)}
          onAwaitingAuthorization={setAuthorizationLaunch}
        />
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel Slack setup?"
        description="The setup is removed from OpenComputer. If Slack already created the app, it stays in your Slack app list; delete it there if you do not need it."
        confirmLabel="Cancel setup"
        cancelLabel="Keep"
        destructive
        pending={cancel.isPending}
        onConfirm={() => setup && cancel.mutate(setup.id)}
      />
    </div>
  )
}

/**
 * Bot name plus a Slack configuration access token. The token is request
 * material: held in component state while the dialog is open, sent once,
 * cleared on every outcome and on close. One request key covers every
 * submission from this dialog, so a retry after a rejected token continues
 * the same setup and a double click cannot create two apps.
 */
function SlackSetupDialog({
  target,
  setup,
  defaultName,
  slotLabel,
  onClose,
  onAwaitingAuthorization,
}: {
  target: ManagedSlackSetupTarget
  setup?: ManagedSlackSetup
  defaultName: string
  slotLabel: string
  onClose: () => void
  onAwaitingAuthorization: (launch: AuthorizationLaunch) => void
}) {
  const queryClient = useQueryClient()
  const queryKey = setupQueryKey(target)
  const [requestKey] = useState(
    () => setup?.requestKey ?? newSlackSetupRequestKey(),
  )
  const resuming = Boolean(setup)
  const [name, setName] = useState(defaultName)
  const [token, setToken] = useState('')
  const [outcome, setOutcome] = useState<ManagedSlackSetup>()
  const [submitError, setSubmitError] = useState<string>()

  const start = useMutation({
    mutationFn: async (input: {
      configurationToken: string
      authorizationWindow: Window
    }) => {
      const result = await startManagedSlackSetup({
        ...target,
        name: name.trim(),
        requestKey,
        configurationToken: input.configurationToken,
      })
      if (result.phase === 'app_created') {
        const { authorizationUrl } = await authorizeManagedSlackSetup(result.id)
        navigateAuthorizationWindow(input.authorizationWindow, authorizationUrl)
      } else {
        input.authorizationWindow.close()
      }
      return result
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result)
      if (result.phase === 'prepared') {
        // An explicit rejection with no side effect: fix the token, same key.
        setOutcome(result)
        return
      }
      if (result.phase === 'app_created') {
        onAwaitingAuthorization(launchFor(result))
      }
      onClose()
    },
    onError: (error, input) => {
      input.authorizationWindow.close()
      if (error instanceof ApiError && error.type === 'slack_setup_active') {
        void queryClient.invalidateQueries({ queryKey })
        notifyError('A Slack setup is already in progress.', error)
        onClose()
        return
      }
      if (
        error instanceof ApiError &&
        error.type === 'slack_already_connected'
      ) {
        void queryClient.invalidateQueries({
          queryKey: ['managed-agent-channels'],
        })
        notifyError('Slack is already connected.', error)
        onClose()
        return
      }
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The Slack app could not be created.',
      )
    },
    onSettled: () => setToken(''),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (start.isPending || !name.trim() || !token.trim()) return
    setOutcome(undefined)
    setSubmitError(undefined)
    // Opened now, inside the click, so the browser allows it; navigated to
    // Slack's consent page once the app exists, closed otherwise.
    let authorizationWindow: Window
    try {
      authorizationWindow = openAuthorizationWindow()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
      return
    }
    start.mutate({ configurationToken: token.trim(), authorizationWindow })
  }
  const rejected = outcome?.error ? describeSlackSetup(outcome) : undefined

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !start.isPending) {
          setToken('')
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create a Slack bot</DialogTitle>
            <DialogDescription>
              For {slotLabel}. OpenComputer creates the app from the
              capabilities declared in code and opens Slack for you to approve
              its installation.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Bot name"
            htmlFor="managed-slack-setup-name"
            description={
              resuming
                ? 'This setup already has a name. Cancel it to start over with another.'
                : 'What people will see in Slack.'
            }
          >
            <Input
              id="managed-slack-setup-name"
              value={name}
              maxLength={35}
              readOnly={resuming}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="App configuration access token"
            htmlFor="managed-slack-setup-token"
          >
            <Input
              id="managed-slack-setup-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="xoxe.xoxp-…"
            />
            <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-5 text-xs">
              <li>
                <a
                  href={SLACK_APPS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  Open your Slack apps <ExternalLink className="size-3" />
                </a>
                . {SLACK_CONFIGURATION_TOKEN_STEPS[0]}
              </li>
              <li>{SLACK_CONFIGURATION_TOKEN_STEPS[1]}</li>
              <li>{SLACK_CONFIGURATION_TOKEN_STEPS[2]}</li>
            </ol>
            <p className="text-muted-foreground mt-2 text-xs">
              The token is used once to create the app and is never stored. It
              expires 12 hours after it is generated; the installed bot does
              not.
            </p>
          </Field>
          {rejected ? (
            <div
              role="alert"
              className="bg-status-error-bg/30 flex items-start gap-2 rounded-md px-3 py-2"
            >
              <CircleAlert
                className="text-status-error mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium">{rejected.title}</p>
                <p className="text-muted-foreground text-xs">
                  {rejected.description}
                </p>
              </div>
            </div>
          ) : submitError ? (
            <p role="alert" className="text-status-error text-sm">
              {submitError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={start.isPending}
              onClick={() => {
                setToken('')
                onClose()
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={start.isPending || !name.trim() || !token.trim()}
            >
              {start.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Creating…
                </>
              ) : rejected ? (
                'Try another token'
              ) : (
                'Create Slack bot'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
