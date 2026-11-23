import { getAccessToken, postWechatApi } from "./wechatApi.js";
import { buildMcpResponse } from "./utils.js";

const MASS_SENDALL_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/sendall";
const MASS_SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/send";
const MASS_PREVIEW_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/preview";
const MASS_GET_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/get";
const MASS_DELETE_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/delete";
const MASS_SPEED_GET_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/speed/get";
const MASS_SPEED_SET_URL = "https://api.weixin.qq.com/cgi-bin/message/mass/speed/set";

const MASS_ERROR_HINTS: Record<number, string> = {
    48001: "公众号未获得群发接口权限。群发接口仅对已认证的订阅号/服务号（含企业认证）开放。",
    40007: "media_id 非法，请确认素材库中存在该 media_id。",
    43004: "目标用户未关注公众号或拒绝接收消息。",
    45002: "消息内容超过长度限制（文本最长 2048 字节，其它类型素材最长 20000 字节）。",
    45008: "media 大小超过限制。",
};

const MASS_MESSAGE_PROPERTIES = {
    msgtype: {
        type: "string",
        enum: ["text", "mpnews", "image", "voice", "video", "wxcard"],
        description:
            "Message type. 'text' = plain text, 'mpnews' = rich media article (media_id from drafts/materials), 'image'/'voice' = media_id, 'video' = media_id + title + description, 'wxcard' = card_id.",
    },
    content: {
        type: "string",
        description: "Text content. REQUIRED when msgtype is 'text' (max 2048 bytes).",
    },
    media_id: {
        type: "string",
        description:
            "Media ID of the material to send. REQUIRED when msgtype is 'mpnews', 'image', 'voice' or 'video'. Obtain it from the drafts box (list_drafts) or the material library.",
    },
    title: {
        type: "string",
        description: "Video title. REQUIRED when msgtype is 'video'.",
    },
    description: {
        type: "string",
        description: "Video description. REQUIRED when msgtype is 'video'.",
    },
    card_id: {
        type: "string",
        description: "Card ID. REQUIRED when msgtype is 'wxcard'.",
    },
    app_id: {
        type: "string",
        description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
    },
};

function buildMassMessage(args: Record<string, any>): Record<string, unknown> {
    const msgtype = String(args.msgtype || "text");
    switch (msgtype) {
        case "text": {
            if (!args.content) {
                throw new Error("msgtype 为 text 时必须提供 content 参数。");
            }
            return { msgtype, text: { content: String(args.content) } };
        }
        case "video": {
            if (!args.media_id || !args.title || !args.description) {
                throw new Error("msgtype 为 video 时必须提供 media_id、title、description 参数。");
            }
            return {
                msgtype,
                video: [{ media_id: String(args.media_id), title: String(args.title), description: String(args.description) }],
            };
        }
        case "wxcard": {
            if (!args.card_id) {
                throw new Error("msgtype 为 wxcard 时必须提供 card_id 参数。");
            }
            return { msgtype, wxcard: { card_id: String(args.card_id) } };
        }
        case "mpnews":
        case "image":
        case "voice": {
            if (!args.media_id) {
                throw new Error(`msgtype 为 ${msgtype} 时必须提供 media_id 参数。`);
            }
            return { msgtype, [msgtype]: { media_id: String(args.media_id) } };
        }
        default:
            throw new Error(`不支持的 msgtype: ${msgtype}，可选值：text、mpnews、image、voice、video、wxcard。`);
    }
}

export const MASS_SEND_ALL_SCHEMA = {
    name: "mass_send_all",
    description:
        "Send a mass message to all followers or followers with a specific tag (根据标签群发/全员群发, cgi-bin/message/mass/sendall). REQUIRED: a verified (企业认证) WeChat MP account. Only 4 mass sends per month to all followers (is_to_all). Use mass_preview to verify before sending.",
    inputSchema: {
        type: "object",
        properties: {
            ...MASS_MESSAGE_PROPERTIES,
            is_to_all: {
                type: "boolean",
                description: "Set true to send to all followers, false to send to followers with the given tag_id. Default false.",
            },
            tag_id: {
                type: "number",
                description: "Target user tag ID. REQUIRED when is_to_all is false.",
            },
            send_ignore_reprint: {
                type: "number",
                description: "For mpnews only. 0 = abort articles flagged as reprinted, 1 = continue sending them. Default 0.",
            },
        },
        required: ["msgtype"],
    },
} as const;

export const MASS_SEND_SCHEMA = {
    name: "mass_send",
    description:
        "Send a mass message to a list of users by OpenID (根据 OpenID 列表群发, cgi-bin/message/mass/send). REQUIRED: a verified (企业认证) WeChat MP account. Max 10000 OpenIDs per call. Use mass_preview to verify before sending.",
    inputSchema: {
        type: "object",
        properties: {
            ...MASS_MESSAGE_PROPERTIES,
            openids: {
                type: "array",
                items: { type: "string" },
                description: "Array of follower OpenIDs (max 10000) to receive the message.",
            },
            send_ignore_reprint: {
                type: "number",
                description: "For mpnews only. 0 = abort articles flagged as reprinted, 1 = continue sending them. Default 0.",
            },
        },
        required: ["msgtype", "openids"],
    },
} as const;

export const MASS_PREVIEW_SCHEMA = {
    name: "mass_preview",
    description:
        "Preview a mass message by sending it to a specified user (群发预览接口, cgi-bin/message/mass/preview). It only affects one user and does not count against the monthly mass-send limit. Use it to check how the message looks before mass_send_all / mass_send.",
    inputSchema: {
        type: "object",
        properties: {
            ...MASS_MESSAGE_PROPERTIES,
            touser: {
                type: "string",
                description: "OpenID of the user who will receive the preview. Use either touser or towxname.",
            },
            towxname: {
                type: "string",
                description: "WeChat ID (微信号) of the user who will receive the preview. Use either touser or towxname.",
            },
        },
        required: ["msgtype"],
    },
} as const;

export const MASS_GET_STATUS_SCHEMA = {
    name: "mass_get_status",
    description:
        "Query the sending status of a mass message by msg_id (查询群发消息发送状态, cgi-bin/message/mass/get). Returns error counts and detailed per-user send results. The msg_id is returned by mass_send_all / mass_send.",
    inputSchema: {
        type: "object",
        properties: {
            msg_id: {
                type: "number",
                description: "The msg_id returned by mass_send_all / mass_send.",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["msg_id"],
    },
} as const;

export const MASS_DELETE_SCHEMA = {
    name: "mass_delete",
    description:
        "Delete a mass message (删除群发, cgi-bin/message/mass/delete). Followers will no longer see the message in their feed. Works for图文消息和视频消息.",
    inputSchema: {
        type: "object",
        properties: {
            msg_id: {
                type: "number",
                description: "The msg_id returned by mass_send_all / mass_send.",
            },
            article_id: {
                type: "number",
                description: "Optional. For multi-article messages, delete the specific article by its index (0-based). Omit to delete the whole message.",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["msg_id"],
    },
} as const;

export const MASS_SPEED_GET_SCHEMA = {
    name: "mass_speed_get",
    description: "Query the current mass-send speed (群发速度查询, cgi-bin/message/mass/speed/get). Returns the current speed value 0-4.",
    inputSchema: {
        type: "object",
        properties: {
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
    },
} as const;

export const MASS_SPEED_SET_SCHEMA = {
    name: "mass_speed_set",
    description:
        "Adjust the mass-send speed (群发速度调整, cgi-bin/message/mass/speed/set). Speed value 0-4 where 0 is the fastest and 4 is the slowest. The original speed can only be restored by a platform administrator.",
    inputSchema: {
        type: "object",
        properties: {
            speed: {
                type: "number",
                description: "Mass-send speed, integer 0-4 (0 = fastest, 4 = slowest).",
            },
            app_id: {
                type: "string",
                description: "AppID for the WeChat MP platform. Optional if WECHAT_APP_ID env var is set.",
            },
        },
        required: ["speed"],
    },
} as const;

export async function massSendAll(args: Record<string, any>, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const isToAll = Boolean(args.is_to_all);
    const tagId = Number(args.tag_id);
    if (!isToAll && Number.isNaN(tagId)) {
        throw new Error("is_to_all 为 false 时必须提供 tag_id 参数。");
    }
    const body: Record<string, unknown> = {
        filter: {
            is_to_all: isToAll,
            ...(isToAll ? {} : { tag_id: tagId }),
        },
        ...buildMassMessage(args),
        ...(args.send_ignore_reprint !== undefined ? { send_ignore_reprint: Number(args.send_ignore_reprint) } : {}),
    };
    const data = await postWechatApi(MASS_SENDALL_URL, accessToken, body, MASS_ERROR_HINTS);
    return buildMcpResponse(
        `群发任务提交成功。msg_id: ${data.msg_id}，msg_data_id: ${data.msg_data_id}。可使用 mass_get_status 查询发送进度，或使用 mass_delete 删除该群发。`,
    );
}

export async function massSend(args: Record<string, any>, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const openids = Array.isArray(args.openids) ? args.openids.map((v: unknown) => String(v)) : [];
    if (openids.length === 0) {
        throw new Error("必须提供 openids 参数（OpenID 列表，最多 10000 个）。");
    }
    const body: Record<string, unknown> = {
        touser: openids,
        ...buildMassMessage(args),
        ...(args.send_ignore_reprint !== undefined ? { send_ignore_reprint: Number(args.send_ignore_reprint) } : {}),
    };
    const data = await postWechatApi(MASS_SEND_URL, accessToken, body, MASS_ERROR_HINTS);
    return buildMcpResponse(
        `群发任务提交成功。msg_id: ${data.msg_id}。可使用 mass_get_status 查询发送进度，或使用 mass_delete 删除该群发。`,
    );
}

export async function massPreview(args: Record<string, any>, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const target: Record<string, string> = {};
    if (args.touser) {
        target.touser = String(args.touser);
    } else if (args.towxname) {
        target.towxname = String(args.towxname);
    } else {
        throw new Error("必须提供 touser（OpenID）或 towxname（微信号）参数之一。");
    }
    const body: Record<string, unknown> = {
        ...target,
        ...buildMassMessage(args),
    };
    await postWechatApi(MASS_PREVIEW_URL, accessToken, body, MASS_ERROR_HINTS);
    return buildMcpResponse(`预览消息已发送至 ${args.touser || args.towxname}，请查收确认效果后再进行正式群发。`);
}

export async function massGetStatus(msgId: number, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await postWechatApi(MASS_GET_URL, accessToken, { msg_id: msgId }, MASS_ERROR_HINTS);
    return buildMcpResponse(JSON.stringify(data, null, 2));
}

export async function massDelete(msgId: number, articleId?: number, appId?: string) {
    const accessToken = await getAccessToken(appId);
    const body: Record<string, unknown> = {
        msg_id: msgId,
        ...(articleId !== undefined ? { article_id: articleId } : {}),
    };
    await postWechatApi(MASS_DELETE_URL, accessToken, body, MASS_ERROR_HINTS);
    return buildMcpResponse("群发消息删除成功，粉丝将不再看到该消息。");
}

export async function massSpeedGet(appId?: string) {
    const accessToken = await getAccessToken(appId);
    const data = await postWechatApi(MASS_SPEED_GET_URL, accessToken, {}, MASS_ERROR_HINTS);
    return buildMcpResponse(`当前群发速度: ${data.speed}（0 最快，4 最慢）。`);
}

export async function massSpeedSet(speed: number, appId?: string) {
    if (!Number.isInteger(speed) || speed < 0 || speed > 4) {
        throw new Error("speed 必须是 0-4 之间的整数（0 最快，4 最慢）。");
    }
    const accessToken = await getAccessToken(appId);
    await postWechatApi(MASS_SPEED_SET_URL, accessToken, { speed }, MASS_ERROR_HINTS);
    return buildMcpResponse(`群发速度已调整为 ${speed}。`);
}
