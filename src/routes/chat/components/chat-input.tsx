import { type FormEvent, type RefObject, useState } from 'react';
import { WebSocket } from 'partysocket';
import { X, FileText, Check, Loader2 } from 'lucide-react';
import { PromptBox } from '@/components/prompt-box';
import { sendWebSocketMessage } from '../utils/websocket-helpers';
import type { ImageAttachment } from '@/api-types';
import { type UsageSummary } from '@/hooks/use-limits';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { TooltipProvider } from '@/components/ui/tooltip';

interface ChatInputProps {
	// Form state
	newMessage: string;
	onMessageChange: (message: string) => void;
	onSubmit: (e: FormEvent) => void;

	// Image upload
	images: ImageAttachment[];
	onAddImages: (files: File[]) => void;
	onRemoveImage: (id: string) => void;
	isProcessing: boolean;

	// Drag and drop
	isChatDragging: boolean;
	chatDragHandlers: {
		onDragEnter: (e: React.DragEvent) => void;
		onDragLeave: (e: React.DragEvent) => void;
		onDragOver: (e: React.DragEvent) => void;
		onDrop: (e: React.DragEvent) => void;
	};

	// Disabled states
	isChatDisabled: boolean;
	isRunning: boolean;
	isGenerating: boolean;
	isGeneratingBlueprint: boolean;
	isDebugging: boolean;

	// WebSocket
	websocket?: WebSocket;

	// Refs
	chatFormRef: RefObject<HTMLFormElement | null>;

	// Usage limits
	limitsData?: UsageSummary | null;
	onConnectCloudflare?: () => void;

	// Integrations
	driveConnected?: boolean;
	driveAllowed?: boolean;
	onDriveStatusChange?: (connected: boolean) => void;
}

export function ChatInput({
	newMessage,
	onMessageChange,
	onSubmit,
	images,
	onAddImages,
	onRemoveImage,
	isProcessing,
	isChatDragging,
	chatDragHandlers,
	isChatDisabled,
	isRunning,
	isGenerating,
	isGeneratingBlueprint,
	isDebugging,
	websocket,
	chatFormRef,
	limitsData,
	onConnectCloudflare,
	driveConnected = false,
	driveAllowed = false,
	onDriveStatusChange,
}: ChatInputProps) {
	const [driveConnecting, setDriveConnecting] = useState(false);
	const handleStopGeneration = () => {
		if (websocket) {
			sendWebSocketMessage(websocket, 'stop_generation');
		}
	};

	const placeholder = isDebugging
		? 'Deep debugging in progress... Please abort to continue'
		: isChatDisabled
			? 'Please wait for blueprint completion...'
			: isRunning
				? 'Chat with AI while generating...'
				: 'Chat with AI...';

	const stopButton = (isGenerating || isGeneratingBlueprint || isDebugging) ? (
		<button
			type="button"
			onClick={handleStopGeneration}
			className="p-1.5 rounded-md hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-all duration-200 group relative"
			aria-label="Stop generation"
			title="Stop generation"
		>
			<X className="size-4" strokeWidth={2} />
			<span className="absolute -top-8 right-0 px-2 py-1 bg-bg-1 border border-border-primary rounded text-xs text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
				Stop
			</span>
		</button>
	) : undefined;

	const handleConnectDrive = async () => {
		setDriveConnecting(true);
		try {
			const res = await apiClient.connectGoogleDrive();
			if (res.data?.authUrl) {
				const popup = window.open(res.data.authUrl, 'google_drive_oauth', 'width=600,height=700');
				const onMessage = (event: MessageEvent) => {
					if (event.data?.type === 'drive-connected') {
						onDriveStatusChange?.(true);
						toast.success('Google Drive connected -- the AI can now access your documents');
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

	// Show tools bar only when there are tools to display
	const hasTools = driveAllowed;

	return (
		<div className="shrink-0">
			<PromptBox
				value={newMessage}
				onChange={onMessageChange}
				onSubmit={() => onSubmit(new Event('submit') as unknown as FormEvent)}
				placeholder={placeholder}
				images={images}
				onAddImages={onAddImages}
				onRemoveImage={onRemoveImage}
				isProcessing={isProcessing}
				compactImagePreview
				isDragging={isChatDragging}
				dragHandlers={chatDragHandlers}
				disabled={isChatDisabled}
				limitsData={limitsData}
				onConnectCloudflare={onConnectCloudflare}
				variant="compact"
				rightActions={stopButton}
				maxWords={4000}
				formRef={chatFormRef}
				className="p-4 pb-2 bg-transparent"
			/>
			{/* Tools bar beneath the prompt input */}
			{hasTools && (
				<div className="flex items-center gap-1.5 px-5 pb-4">
					<span className="text-xs text-text-tertiary mr-1">Tools:</span>
					<TooltipProvider delayDuration={200}>
						{driveAllowed && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={driveConnected ? undefined : handleConnectDrive}
										disabled={driveConnecting}
										className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
											driveConnected
												? 'bg-green-500/10 text-green-600 border border-green-500/20'
												: 'bg-muted hover:bg-accent/10 text-text-secondary hover:text-text-primary border border-transparent'
										}`}
									>
										{driveConnecting ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : driveConnected ? (
											<Check className="h-3 w-3" />
										) : (
											<FileText className="h-3 w-3" />
										)}
										Google Drive
									</button>
								</TooltipTrigger>
								<TooltipContent side="top" className="text-xs">
									{driveConnected
										? 'Connected -- AI can search and read your Google Docs'
										: 'Connect to use your Google Docs as data sources'}
								</TooltipContent>
							</Tooltip>
						)}
					</TooltipProvider>
				</div>
			)}
		</div>
	);
}
