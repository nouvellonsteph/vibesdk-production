import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { ArrowRight, Info } from 'react-feather';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/auth-context';
import { ProjectModeSelector, type ProjectModeOption } from '../components/project-mode-selector';
import { MAX_AGENT_QUERY_LENGTH, SUPPORTED_IMAGE_MIME_TYPES, type ProjectType } from '@/api-types';
import { useFeature } from '@/features';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { usePaginatedApps } from '@/hooks/use-paginated-apps';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { AppCard } from '@/components/shared/AppCard';
import clsx from 'clsx';
import { useImageUpload } from '@/hooks/use-image-upload';
import { useDragDrop } from '@/hooks/use-drag-drop';
import { toast } from 'sonner';
import { useLimitsContext } from '@/contexts/limits-context';
import { checkCanSendPrompt } from '@/utils/usage-limit-checker';
import { PromptBox } from '@/components/prompt-box';
import { apiClient } from '@/lib/api-client';
import { FileText, Check } from 'lucide-react';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	TooltipProvider,
} from '@/components/ui/tooltip';

export default function Home() {
	const navigate = useNavigate();
	const { requireAuth } = useAuthGuard();
	const [projectMode, setProjectMode] = useState<ProjectType>('app');
	const [query, setQuery] = useState('');
	const { user } = useAuth();
	const { isLoadingCapabilities, capabilities, getEnabledFeatures } = useFeature();
	const { data: limitsData, loading: usageLimitsLoading } = useLimitsContext();
	const [showLimitDialog, setShowLimitDialog] = useState<React.ReactElement | null>(null);

	const handleConnectCloudflare = useCallback(() => {
		window.location.href = `/oauth/login?return_url=${encodeURIComponent(window.location.href)}`;
	}, []);

	// Google Drive integration
	const [driveAvailable, setDriveAvailable] = useState(false);
	const [driveConnected, setDriveConnected] = useState(false);
	const [driveConnecting, setDriveConnecting] = useState(false);

	useEffect(() => {
		if (user) {
			apiClient.listIntegrations().then((res) => {
				if (res.data) {
					const avail = (res.data as { available?: { googleDrive?: { configured: boolean; enabled: boolean; tierAllowed: boolean } } }).available?.googleDrive;
					setDriveAvailable(!!(avail?.configured && avail?.enabled && avail?.tierAllowed));
					const drive = (res.data as { integrations?: Array<{ provider: string; isActive: boolean }> }).integrations?.find((i) => i.provider === 'google_drive');
					if (drive?.isActive) setDriveConnected(true);
				}
			}).catch(() => {});
		}
	}, [user]);

	const handleConnectDrive = async () => {
		setDriveConnecting(true);
		try {
			const res = await apiClient.connectGoogleDrive();
			if (res.data?.authUrl) {
				const popup = window.open(res.data.authUrl, 'google_drive_oauth', 'width=600,height=700');
				const onMessage = (event: MessageEvent) => {
					if (event.data?.type === 'drive-connected') {
						setDriveConnected(true);
						toast.success('Google Drive connected -- mention your docs in the prompt!');
						window.removeEventListener('message', onMessage);
					}
				};
				window.addEventListener('message', onMessage);
				const interval = setInterval(() => {
					if (popup?.closed) {
						clearInterval(interval);
						setDriveConnecting(false);
						window.removeEventListener('message', onMessage);
					}
				}, 500);
			}
		} catch {
			toast.error('Failed to connect Google Drive');
			setDriveConnecting(false);
		}
	};

	const modeOptions = useMemo<ProjectModeOption[]>(() => {
		if (isLoadingCapabilities || !capabilities) return [];
		return getEnabledFeatures().map((def) => ({
			id: def.id,
			label:
				def.id === 'presentation'
					? 'Slides'
					: def.id === 'general'
						? 'General'
						: 'App',
			description: def.description,
		}));
	}, [capabilities, getEnabledFeatures, isLoadingCapabilities]);

	const showModeSelector = modeOptions.length > 1;

	useEffect(() => {
		if (isLoadingCapabilities) return;
		if (modeOptions.length === 0) {
			if (projectMode !== 'app') setProjectMode('app');
			return;
		}
		if (!modeOptions.some((m) => m.id === projectMode)) {
			setProjectMode(modeOptions[0].id);
		}
	}, [isLoadingCapabilities, modeOptions, projectMode]);

	const { images, addImages, removeImage, clearImages, isProcessing } = useImageUpload({
		onError: (error) => {
			console.error('Image upload error:', error);
			toast.error(error);
		},
	});

	const { isDragging, dragHandlers } = useDragDrop({
		onFilesDropped: addImages,
		accept: [...SUPPORTED_IMAGE_MIME_TYPES],
	});


	const placeholderPhrases = useMemo(() => [
		"todo list app",
		"F1 fantasy game",
		"personal finance tracker"
	], []);

	const {
		apps,
		loading,
	} = usePaginatedApps({
		type: 'public',
		defaultSort: 'popular',
		defaultPeriod: 'week',
		limit: 6,
	});

	// Discover section should appear only when enough apps are available and loading is done
	const discoverReady = useMemo(() => !loading && (apps?.length ?? 0) > 5, [loading, apps]);

	const handleCreateApp = (query: string, mode: ProjectType) => {
		if (query.length > MAX_AGENT_QUERY_LENGTH) {
			toast.error(
				`Prompt too large (${query.length} characters). Maximum allowed is ${MAX_AGENT_QUERY_LENGTH} characters.`,
			);
			return;
		}

		if (user && usageLimitsLoading) {
			return;
		}

		const encodedQuery = encodeURIComponent(query);
		const encodedMode = encodeURIComponent(mode);

		// Encode images as JSON if present
		const imageParam = images.length > 0 ? `&images=${encodeURIComponent(JSON.stringify(images))}` : '';
		const intendedUrl = `/chat/new?query=${encodedQuery}&projectType=${encodedMode}${imageParam}`;

		if (
			!requireAuth({
				requireFullAuth: true,
				actionContext: 'to create applications',
				intendedUrl: intendedUrl,
			})
		) {
			return;
		}

		// Check usage limits before proceeding
		const limitCheck = checkCanSendPrompt(
			limitsData,
			usageLimitsLoading,
			() => { window.location.href = `/oauth/login?return_url=${encodeURIComponent(window.location.href)}`; },
			() => setShowLimitDialog(null)
		);

		if (!limitCheck.canProceed) {
			setShowLimitDialog(limitCheck.dialogComponent || null);
			return;
		}

		// User is already authenticated, navigate immediately
		navigate(intendedUrl);
		// Clear images after navigation
		clearImages();
	};


	const discoverLinkRef = useRef<HTMLDivElement>(null);

	return (
		<div className="relative flex flex-col items-center size-full">
			{/* Dotted background pattern - extends to full viewport */}
			<div className="fixed inset-0 text-accent z-0 opacity-20 pointer-events-none">
				<svg width="100%" height="100%">
					<defs>
						<pattern
							id=":S2:"
							viewBox="-6 -6 12 12"
							patternUnits="userSpaceOnUse"
							width="12"
							height="12"
						>
							<circle
								cx="0"
								cy="0"
								r="1"
								fill="currentColor"
							></circle>
						</pattern>
					</defs>
					<rect
						width="100%"
						height="100%"
						fill="url(#:S2:)"
					></rect>
				</svg>
			</div>

			<LayoutGroup>
				<div className="rounded-md w-full max-w-2xl overflow-hidden">
					<motion.div
						layout
						transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
						className={clsx(
							"px-6 p-8 flex flex-col items-center z-10",
							discoverReady ? "mt-48" : "mt-[20vh] sm:mt-[24vh] md:mt-[28vh]"
						)}>
						<h1 className="text-shadow-sm text-shadow-red-200 dark:text-shadow-red-900 text-accent font-medium leading-[1.1] tracking-tight text-5xl w-full mb-4 bg-clip-text bg-gradient-to-r from-text-primary to-text-primary/90">
							What should we build today?
						</h1>
						<PromptBox
							value={query}
							onChange={setQuery}
							onSubmit={() => handleCreateApp(query, projectMode)}
							placeholder="Create a "
							animatedPlaceholder
							placeholderPhrases={placeholderPhrases}
							images={images}
							onAddImages={addImages}
							onRemoveImage={removeImage}
							isProcessing={isProcessing || (user ? usageLimitsLoading : false)}
							isDragging={isDragging}
							dragHandlers={dragHandlers}
							submitDisabled={user ? usageLimitsLoading : false}
							limitsData={user ? limitsData : undefined}
							onConnectCloudflare={handleConnectCloudflare}
							variant="expanded"
							submitIcon={user && usageLimitsLoading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
							leftActions={
								showModeSelector ? (
									<ProjectModeSelector
										value={projectMode}
										onChange={setProjectMode}
										modes={modeOptions}
										className="flex-1"
									/>
								) : undefined
							}
						/>
						{/* Tools bar -- integrations available for the prompt */}
						{driveAvailable && (
							<div className="flex items-center gap-2 mt-3 ml-1">
								<span className="text-xs text-text-tertiary">Data sources:</span>
								<TooltipProvider delayDuration={200}>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												onClick={driveConnected ? undefined : handleConnectDrive}
												disabled={driveConnecting}
												className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
													driveConnected
														? 'bg-green-500/10 text-green-500 border border-green-500/20 cursor-default'
														: 'bg-bg-3/80 hover:bg-accent/10 text-text-secondary hover:text-accent border border-text/10 hover:border-accent/30'
												}`}
											>
												{driveConnecting ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
												) : driveConnected ? (
													<Check className="h-3.5 w-3.5" />
												) : (
													<FileText className="h-3.5 w-3.5" />
												)}
												Google Drive
											</button>
										</TooltipTrigger>
										<TooltipContent side="bottom" className="text-xs max-w-64">
											{driveConnected
												? 'Connected. Mention your Google Docs or Sheets in the prompt and the AI will use them as data sources.'
												: 'Connect your Google Drive to build apps using your documents and spreadsheets as data sources.'}
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</div>
						)}
					</motion.div>

				</div>

				<AnimatePresence>
					{images.length > 0 && (
						<motion.div
							initial={{ opacity: 0, y: -10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							className="w-full max-w-2xl px-6"
						>
							<div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-bg-4/50 dark:bg-bg-2/50 border border-accent/20 dark:border-accent/30 shadow-sm">
								<Info className="size-4 text-accent flex-shrink-0 mt-0.5" />
								<p className="text-xs text-text-tertiary leading-relaxed">
									<span className="font-medium text-text-secondary">Images Beta:</span> Images guide app layout and design but may not be replicated exactly. The coding agent cannot access images directly for app assets.
								</p>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				<AnimatePresence>
					{discoverReady && (
						<motion.section
							key="discover-section"
							layout
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
							className={clsx('max-w-6xl mx-auto px-4 z-10', images.length > 0 ? 'mt-10' : 'mt-16 mb-8')}
						>
							<div className='flex flex-col items-start'>
								<h2 className="text-2xl font-medium text-text-secondary/80">Discover Apps built by the community</h2>
								<div ref={discoverLinkRef} className="text-md font-light mb-4 text-text-tertiary hover:underline underline-offset-4 select-text cursor-pointer" onClick={() => navigate('/discover')} >View All</div>
								<motion.div
									layout
									transition={{ duration: 0.4 }}
									className="grid grid-cols-2 xl:grid-cols-3 gap-6"
								>
									<AnimatePresence mode="popLayout">
										{apps.map(app => (
											<AppCard
												key={app.id}
												app={app}
												onClick={() => navigate(`/app/${app.id}`)}
												showStats={true}
												showUser={true}
												showActions={false}
											/>
										))}
									</AnimatePresence>
								</motion.div>
							</div>
						</motion.section>
					)}
				</AnimatePresence>
			</LayoutGroup>

			{/* Nudge towards Discover */}
			{user && <CurvedArrow sourceRef={discoverLinkRef} target={{ x: 50, y: window.innerHeight - 60 }} />}

			{/* Usage limit dialogs */}
			{showLimitDialog}
		</div>
	);
}



type ArrowProps = {
	/** Ref to the source element the arrow starts from */
	sourceRef: React.RefObject<HTMLElement | null>;
	/** Target point in viewport/client coordinates */
	target: { x: number; y: number };
	/** Curve intensity (0.1 - 1.5 is typical) */
	curvature?: number;
	/** Optional pixel offset from source element edge */
	sourceOffset?: number;
	/** If true, hides the arrow when the source is offscreen/not measurable */
	hideWhenInvalid?: boolean;
};

type Point = { x: number; y: number };

export const CurvedArrow: React.FC<ArrowProps> = ({
	sourceRef,
	target,
	curvature = 0.5,
	sourceOffset = 6,
	hideWhenInvalid = true,
}) => {
	const [start, setStart] = useState<Point | null>(null);
	const [end, setEnd] = useState<Point | null>(null);

	const rafRef = useRef<number | null>(null);
	const roRef = useRef<ResizeObserver | null>(null);

	const compute = () => {
		const el = sourceRef.current;
		if (!el) {
			setStart(null);
			setEnd(null);
			return;
		}

		const rect = el.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) {
			setStart(null);
			setEnd(null);
			return;
		}

		const endPoint: Point = { x: target.x, y: target.y };

		// Choose an anchor on the source: midpoint of the side facing the target
		const centers = {
			right: { x: rect.right, y: rect.top + rect.height / 2 },
			left: { x: rect.left, y: rect.top + rect.height / 2 },
		};

		// Distances to target from each side center
		const dists = Object.fromEntries(
			Object.entries(centers).map(([side, p]) => [
				side,
				(p.x - endPoint.x) ** 2 + (p.y - endPoint.y) ** 2,
			])
		) as Record<keyof typeof centers, number>;

		const bestSide = (Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0] ||
			"right") as keyof typeof centers;

		// Nudge start point slightly outside the element for visual clarity
		const nudge = (p: Point, side: keyof typeof centers, offset: number) => {
			switch (side) {
				case "right":
					return { x: p.x + offset, y: p.y };
				case "left":
					return { x: p.x - offset, y: p.y };
			}
		};

		const startPoint = nudge(centers[bestSide], bestSide, sourceOffset);

		setStart(startPoint);
		setEnd(endPoint);
	};

	// Throttle updates with rAF to avoid layout thrash
	const scheduleCompute = () => {
		if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(compute);
	};

	useEffect(() => {
		scheduleCompute();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target.x, target.y, sourceRef.current]);

	useEffect(() => {
		const onScroll = () => scheduleCompute();
		const onResize = () => scheduleCompute();

		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onResize);

		// Track source element size changes
		const el = sourceRef.current;
		if ("ResizeObserver" in window) {
			roRef.current = new ResizeObserver(() => scheduleCompute());
			if (el) roRef.current.observe(el);
		}

		scheduleCompute();

		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			if (roRef.current && el) roRef.current.unobserve(el);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const d = useMemo(() => {
		if (!start || !end) return "";

		const dx = end.x - start.x;
		const dy = end.y - start.y;

		// Control points: bend the curve based on the primary axis difference.
		// This gives a nice S or C curve without sharp kinks.
		const cpOffset = Math.max(Math.abs(dx), Math.abs(dy)) * curvature;

		const c1: Point = { x: start.x + cpOffset * (dx >= 0 ? 1 : -1), y: start.y };
		const c2: Point = { x: end.x - cpOffset * (dx >= 0 ? 1 : -1), y: end.y };

		return `M ${start.x},${start.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`;
	}, [start, end, curvature]);

	const hidden = hideWhenInvalid && (!start || !end);

	if (start && end && (end.y - start.y > 420 || start.x - end.x < 100)) {
		return null;
	}

	return (
		<svg
			aria-hidden="true"
			style={{
				position: "fixed",
				inset: 0,
				width: "100vw",
				height: "100vh",
				pointerEvents: "none",
				overflow: "visible",
				zIndex: 9999,
				display: hidden ? "none" : "block",
			}}
		>
			<defs>
				<filter id="discover-squiggle" x="-20%" y="-20%" width="140%" height="140%">
					<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="3" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="1" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				<marker id="discover-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth" opacity={0.20}>
					<path d="M 0 1.2 L 7 4" stroke="var(--color-text-tertiary)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
					<path d="M 0 6.8 L 7 4" stroke="var(--color-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
				</marker>
			</defs>

			<path
				d={d}
				// stroke="var(--color-accent)"
				stroke="var(--color-text-tertiary)"
				strokeOpacity={0.20}
				strokeWidth={1.6}
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
				markerEnd="url(#discover-arrowhead)"
			/>
			{/* Soft squiggle overlay for hand-drawn feel */}
			<g filter="url(#discover-squiggle)">
				<path
					d={d}
					// stroke="var(--color-accent)"
					stroke="var(--color-text-tertiary)"
					strokeOpacity={0.12}
					strokeWidth={1}
					fill="none"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray="8 6 4 9 5 7"
					vectorEffect="non-scaling-stroke"
				/>
			</g>
		</svg>
	);
};
