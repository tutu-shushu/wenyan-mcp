import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LIST_THEMES_SCHEMA, REGISTER_THEME_SCHEMA, REMOVE_THEME_SCHEMA } from "./theme.js";
import { PUBLISH_ARTICLE_SCHEMA, publishArticle } from "./publish.js";
import {
    DELETE_PUBLISH_SCHEMA,
    GET_PUBLISH_STATUS_SCHEMA,
    LIST_DRAFTS_SCHEMA,
    PUBLISH_DRAFT_SCHEMA,
    deletePublish,
    getPublishStatus,
    listDrafts,
    publishDraft,
} from "./freepublish.js";
import pkg from "../package.json" with { type: "json" };
import { buildMcpResponse, globalStates } from "./utils.js";
import { addTheme, listThemes, removeTheme } from "@wenyan-md/core/wrapper";

/**
 * Create and configure an MCP server instance.
 */
export function createServer(): Server {
    const server = new Server(
        {
            name: "wenyan-mcp",
            version: pkg.version,
        },
        {
            capabilities: {
                resources: {},
                tools: {},
                prompts: {},
                // logging: {},
            },
        },
    );

    /**
     * Handler that lists available tools.
     * Exposes a single "publish_article" tool that lets clients publish new article.
     */
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                PUBLISH_ARTICLE_SCHEMA,
                LIST_THEMES_SCHEMA,
                REGISTER_THEME_SCHEMA,
                REMOVE_THEME_SCHEMA,
                LIST_DRAFTS_SCHEMA,
                PUBLISH_DRAFT_SCHEMA,
                GET_PUBLISH_STATUS_SCHEMA,
                DELETE_PUBLISH_SCHEMA,
            ],
        };
    });

    /**
     * Handler for the publish_article tool.
     * Publish a new article with the provided title and content, and returns success message.
     */
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
            if (request.params.name === "publish_article") {
                if (globalStates.isClientMode && !globalStates.serverUrl) {
                    throw new Error("Missing server URL. Usage: --server <server_url>");
                }
                const args = request.params.arguments || {};
                const content = String(args.content || "");
                const contentUrl = String(args.content_url || "");
                const file = String(args.file || "");
                const themeId = String(args.theme_id || "");
                const appId = String(args.app_id || "");
                return await publishArticle(contentUrl, file, content, themeId, appId, pkg.version);
            } else if (request.params.name === "list_themes") {
                const themes = await listThemes();
                const builtinThemes = themes.filter((theme) => theme.isBuiltin);
                const customThemes = themes.filter((theme) => !theme.isBuiltin);
                return {
                    content: [
                        ...builtinThemes.map((theme) => ({
                            type: "text",
                            text: JSON.stringify({
                                id: theme.id,
                                name: theme.name,
                                description: theme.description,
                            }),
                        })),
                        ...customThemes.map((theme) => ({
                            type: "text",
                            text: JSON.stringify({
                                id: theme.id,
                                name: theme.name ?? theme.id,
                                description: theme.description ?? "自定义主题，暂无描述。",
                            }),
                        })),
                    ],
                };
            } else if (request.params.name === "register_theme") {
                const name = String(request.params.arguments?.name || "");
                const path = String(request.params.arguments?.path || "");
                await addTheme(name, path);
                return buildMcpResponse(`Theme "${name}" has been added successfully.`);
            } else if (request.params.name === "list_drafts") {
                const args = request.params.arguments || {};
                const offset = Number(args.offset || 0);
                const count = Number(args.count || 10);
                const appId = String(args.app_id || "");
                return await listDrafts(offset, count, appId || undefined);
            } else if (request.params.name === "publish_draft") {
                const mediaId = String(request.params.arguments?.media_id || "");
                if (!mediaId) {
                    throw new Error("Missing required argument: media_id");
                }
                const appId = String(request.params.arguments?.app_id || "");
                return await publishDraft(mediaId, appId || undefined);
            } else if (request.params.name === "get_publish_status") {
                const publishId = String(request.params.arguments?.publish_id || "");
                if (!publishId) {
                    throw new Error("Missing required argument: publish_id");
                }
                const appId = String(request.params.arguments?.app_id || "");
                return await getPublishStatus(publishId, appId || undefined);
            } else if (request.params.name === "delete_publish") {
                const publishId = String(request.params.arguments?.publish_id || "");
                const articleId = String(request.params.arguments?.article_id || "");
                if (!publishId || !articleId) {
                    throw new Error("Missing required arguments: publish_id, article_id");
                }
                const appId = String(request.params.arguments?.app_id || "");
                return await deletePublish(publishId, articleId, appId || undefined);
            } else if (request.params.name === "remove_theme") {
                const name = String(request.params.arguments?.name || "");
                await removeTheme(name);
                return buildMcpResponse(`Theme "${name}" has been removed successfully.`);
            }

            throw new Error("Unknown tool");
        } catch (error: any) {
            console.error(`[MCP Tool Error] (${request.params.name}):`, error.message);
            return buildMcpResponse(`执行工具失败: ${error.message}`);
        }
    });

    return server;
}
