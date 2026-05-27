import { CodingAgentController } from '../controllers/agent/controller';
import { AppEnv } from '../../types/appenv';
import { Hono } from 'hono';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { adaptController } from '../honoAdapter';

/**
 * Setup and configure the application router
 */
export function setupCodegenRoutes(app: Hono<AppEnv>): void {
    // ========================================
    // CODE GENERATION ROUTES
    // ========================================
    
    // CRITICAL: Create new app - requires full authentication
    app.post('/api/agent', setAuthLevel(AuthConfig.authenticated), adaptController(CodingAgentController, CodingAgentController.startCodeGeneration));
    
    // ========================================
    // APP EDITING ROUTES (/chat/:id frontend)
    // ========================================
    
    // WebSocket for app editing - OWNER ONLY with ticket support
    // Supports ticket-based auth (SDK) or JWT-based auth (browser)
    app.get('/api/agent/:agentId/ws', setAuthLevel(AuthConfig.ownerOnly, { 
        ticketAuth: { resourceType: 'agent', paramName: 'agentId' } 
    }), adaptController(CodingAgentController, CodingAgentController.handleWebSocketConnection));
    
    // Connect to existing agent for editing - OWNER ONLY
    // Only the app owner should be able to connect for editing purposes
    app.get('/api/agent/:agentId/connect', setAuthLevel(AuthConfig.ownerOnly), adaptController(CodingAgentController, CodingAgentController.connectToExistingAgent));

    app.get('/api/agent/:agentId/preview', setAuthLevel(AuthConfig.authenticated), adaptController(CodingAgentController, CodingAgentController.deployPreview));

    // Deploy to Cloudflare Workers for Platforms (HTTP POST, bypasses WebSocket)
    app.post('/api/agent/:agentId/deploy', setAuthLevel(AuthConfig.ownerOnly), adaptController(CodingAgentController, CodingAgentController.deployToCloudflare));

    // Slug management
    app.put('/api/agent/:agentId/slug', setAuthLevel(AuthConfig.ownerOnly), adaptController(CodingAgentController, CodingAgentController.setSlug));
    app.get('/api/agent/check-slug', setAuthLevel(AuthConfig.authenticated), adaptController(CodingAgentController, CodingAgentController.checkSlug));
}