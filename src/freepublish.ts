import { credentialStore, wechatPublisher } from "@wenyan-md/core/wrapper";
import { buildMcpResponse } from "./utils.js";

const FREEPUBLISH_SUBMIT_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/submit";
const FREEPUBLISH_GET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/get";
const FREEPUBLISH_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";
const FREEPUBLISH_DELETE_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/delete";

const WECHAT_ERROR_HINTS: Record<number, string> = {
    48001: "公众号未获得该接口权限。freepublish（发布能力）仅对已认证的订阅号/服务号（含企业认证）开放。",
    40007: "media_id 非法，请确认草稿箱中存在该 media_id。",
    53418: "正在发布中，请稍后再试或查询发布状态。",
    53417: "该草稿不在发布范围内（可能是图文类型不支持或账号未认证）。",
};

function assertWechatSuccess(data: any) {
    if ("errcode" in data && data.errcode !== 0) {
        const hint = WECHAT_ERROR_HINTS[data.errcode];
        throw new Error(hint ? `${data.errcode}: ${hint} (${data.errmsg})` : `${data.errcode}: ${data.errmsg}`);
    }
}

/**
 * Resolve appId/appSecret from arguments, env vars, or the wenyan config store.
 */
async function resolveCredential(appId?: string) {
    const envAppId = process.env.WECHAT_APP_ID;
    const envAppSecret = process.env.WECHAT_APP_SECRET;
    if (envAppId && envAppSecret && (envAppId === appId || !appId)) {
        return { appId: envAppId, appSecret: envAppSecret };
    }
    if (!appId) {
        throw new Error("未提供 AppID：请通过环境变量 WECHAT_APP_ID / WECHAT_APP_SECRET 指定。");
    }
    const credential = await credentialStore.getWechatCredential(appId);
    if (credential?.appId && credential?.appSecret) {
        return { appId: credential.appId, appSecret: credential.appSecret };
    }
    throw new Error(`未能找到 AppID 为 "${appId}" 的公众号凭据，请检查配置文件。`);
}

async function getAccessToken(appId?: string) {
    const { appId: finalAppId, appSecret } = await resolveCredential(appId);
    return await wechatPublisher.getAccessTokenWithCache(finalAppId, appSecret);
}

async function postWechatApi(url: string, accessToken: string, body: Record<string, unknown>) {
    const res = await fetch(`${url}?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`微信接口请求失败: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    assertWechatSuccess(data);
    return data;
}

export const LIST_DRAFTS_SCHEMA = {
    name: "list_drafts",
    description:
        "List articles in the '微信公众号' draft box. Returns media_id, title and update time for each draft. Use this before publish_draft to find the target article.",
    inputSchema: {
        type: "object",
        properties: {
            offset: {
                type: "number",
                description: "Pagination offset, starting from 0. Default 0.",
            },
            count: {
                type: "number",
                description: "Number of drafts to fetch (1-20). Default 10.",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
    },
} as const;

export const PUBLISH_DRAFT_SCHEMA = {
    name: "publish_draft",
    description:
        "Publish an article from the '微信公众号' draft box to the public feed (一键发布/群发). REQUIRED: a verified (企业认证) WeChat MP account. Provide the media_id obtained from list_drafts. Returns publish_id for tracking with get_publish_status.",
    inputSchema: {
        type: "object",
        properties: {
            media_id: {
                type: "string",
                description: "The media_id of the draft article to publish (from list_drafts or publish_article).",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["media_id"],
    },
} as const;

export const GET_PUBLISH_STATUS_SCHEMA = {
    name: "get_publish_status",
    description:
        "Query the publish status of an article in '微信公众号' by publish_id (returned by publish_draft). Returns publish_status, article_url when done, or failed article indexes.",
    inputSchema: {
        type: "object",
        properties: {
            publish_id: {
                type: "string",
                description: "The publish_id returned by publish_draft.",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["publish_id"],
    },
} as const;

export const DELETE_PUBLISH_SCHEMA = {
    name: "delete_publish",
    description:
        "Delete a published article from '微信公众号' by publish_id and article_id (both returned by get_publish_status).",
    inputSchema: {
        type: "object",
        properties: {
            publish_id: {
                type: "string",
                description: "The publish_id returned by publish_draft.",
            },
            article_id: {
                type: "string",
                description: "The article_id returned by get_publish_status.",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["publish_id", "article_id"],
    },
} as const;

export async function listDrafts(offset: number, count: number, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await wechatPublisher.listDrafts(accessToken, offset, count, 0);
    return buildMcpResponse(JSON.stringify(data, null, 2));
}

export async function publishDraft(mediaId: string, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await postWechatApi(FREEPUBLISH_SUBMIT_URL, accessToken, { media_id: mediaId });
    return buildMcpResponse(
        `发布任务已提交成功。publish_id: ${data.publish_id}。可使用 get_publish_status 工具查询发布进度与最终文章链接。`,
    );
}

export async function getPublishStatus(publishId: string, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await postWechatApi(FREEPUBLISH_GET_URL, accessToken, { publish_id: publishId });
    return buildMcpResponse(JSON.stringify(data, null, 2));
}

export async function deletePublish(publishId: string, articleId: string, appId?: string) {
    const accessToken = await getAccessToken(appId);
    await postWechatApi(FREEPUBLISH_DELETE_URL, accessToken, { publish_id: publishId, article_id: articleId });
    return buildMcpResponse("已发布文章删除成功。");
}

export async function listPublishStatus(offset: number, count: number, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await postWechatApi(FREEPUBLISH_BATCHGET_URL, accessToken, { offset, count });
    return buildMcpResponse(JSON.stringify(data, null, 2));
}
