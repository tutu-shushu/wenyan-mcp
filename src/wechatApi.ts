import { credentialStore, wechatPublisher } from "@wenyan-md/core/wrapper";

const WECHAT_ERROR_HINTS: Record<number, string> = {
    48001: "公众号未获得该接口权限，请确认账号已完成认证且具备对应接口能力。",
    40007: "media_id 非法，请确认素材存在且属于当前公众号。",
};

export function assertWechatSuccess(data: any, extraHints?: Record<number, string>) {
    if ("errcode" in data && data.errcode !== 0) {
        const hint = extraHints?.[data.errcode] ?? WECHAT_ERROR_HINTS[data.errcode];
        throw new Error(hint ? `${data.errcode}: ${hint} (${data.errmsg})` : `${data.errcode}: ${data.errmsg}`);
    }
}

/**
 * Resolve appId/appSecret from arguments, env vars, or the wenyan config store.
 */
export async function resolveCredential(appId?: string) {
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

export async function getAccessToken(appId?: string) {
    const { appId: finalAppId, appSecret } = await resolveCredential(appId);
    return await wechatPublisher.getAccessTokenWithCache(finalAppId, appSecret);
}

export async function postWechatApi(
    url: string,
    accessToken: string,
    body: Record<string, unknown>,
    extraHints?: Record<number, string>,
) {
    const res = await fetch(`${url}?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`微信接口请求失败: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    assertWechatSuccess(data, extraHints);
    return data;
}
