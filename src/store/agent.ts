/**
 * Agent 设置。
 *
 * 全部是本地偏好：模型地址、模型名、API Key 都不进报告文件。
 * Key 明文存在 `cache/ui-preferences.json`，个人使用场景下够用 ——
 * 真要提高安全性应该换成系统凭据管理器，那是后话。
 */
export type AgentProvider = "deepseek" | "openai" | "custom";

export interface AgentSettings {
	provider: AgentProvider;
	/** 接口根地址，例如 https://api.deepseek.com（带不带版本段都行，末尾接 /chat/completions） */
	baseUrl: string;
	/** 模型名，例如 deepseek-chat */
	model: string;
	/**
	 * 每个服务商**各自的** Key。
	 *
	 * 不能让 DeepSeek 的 key 顺延到 OpenAI —— 那是两套账号体系，混用只会得到 401。
	 * 切服务商时地址和模型跟着换，Key 也跟着换成那个服务商自己的。
	 */
	apiKeys: Record<AgentProvider, string>;
	/**
	 * 允不允许模型创建图片元素。
	 *
	 * 关掉时它只能用 rect 占位，图片留给用户自己填 —— 因为模型并不知道
	 * 文档里有哪些媒体文件，猜路径既费 token 又基本会失败。
	 */
	generateImages: boolean;
}

export interface AgentProviderPreset {
	value: AgentProvider;
	label: string;
	/** 接口根地址 */
	baseUrl: string;
	models: string[];
	/** 不支持工具调用的模型（选了会让 agent 变成纯聊天） */
	noTools?: string[];
	/** 是否需要 API Key：本地模型（Ollama 之类）不需要 */
	requiresKey?: boolean;
	note?: string;
}

/**
 * 预置服务商。
 * 都是 OpenAI 兼容协议，所以换服务商只是换地址和模型名，调用逻辑不变。
 */
export const AGENT_PROVIDERS: AgentProviderPreset[] = [
	{
		value: "deepseek",
		label: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		models: ["deepseek-chat", "deepseek-reasoner"],
		// reasoner 系列对 function calling 支持有限，选了它 agent 只能聊天
		noTools: ["deepseek-reasoner"],
		requiresKey: true,
		note: "deepseek-chat 支持工具调用；reasoner 不支持，选了只能聊天",
	},
	{
		value: "openai",
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		models: ["gpt-4o-mini", "gpt-4o"],
		requiresKey: true,
		note: "需要 OpenAI 自己的 Key，和 DeepSeek 的不通用",
	},
	{
		value: "custom",
		label: "自定义（OpenAI 兼容）",
		baseUrl: "",
		models: [],
		// 本地 Ollama / vLLM 之类通常不校验 Key
		requiresKey: false,
		note: "填任意 OpenAI 兼容端点，例如本地 Ollama：http://localhost:11434/v1；不需要 Key 时可留空",
	},
];

export function getProviderPreset(provider: AgentProvider): AgentProviderPreset {
	return AGENT_PROVIDERS.find((item) => item.value === provider) ?? AGENT_PROVIDERS[0];
}

/**
 * 这个服务商要不要 Key。
 *
 * DeepSeek / OpenAI 一定要。
 * 「自定义」不能一律免 Key —— 用户可能把自定义端点指向远端服务（我们见过把
 * DeepSeek 地址填进自定义的情况，那样会静默发出一个不带凭据的请求，得到 401）。
 * 判断依据是地址：本机地址（localhost / 127.0.0.1 / ::1）才认为不需要 Key。
 */
export function providerRequiresKey(provider: AgentProvider, baseUrl = ""): boolean {
	if (provider !== "custom") {
		return getProviderPreset(provider).requiresKey !== false;
	}
	const url = baseUrl.trim();
	if (!url) {
		return true;
	}
	return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url);
}

/** 这个模型能不能用工具调用 */
export function supportsTools(settings: AgentSettings): boolean {
	const preset = getProviderPreset(settings.provider);
	return !(preset.noTools ?? []).includes(settings.model);
}

const EMPTY_KEYS: Record<AgentProvider, string> = {
	deepseek: "",
	openai: "",
	custom: "",
};

const INITIAL: AgentSettings = {
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	model: "deepseek-chat",
	apiKeys: { ...EMPTY_KEYS },
	generateImages: false,
};

class AgentStore {
	private state: AgentSettings = INITIAL;
	private listeners = new Set<() => void>();

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.state;

	getState() {
		return this.state;
	}

	/** 有没有配好能用的凭据（只做本地判断，不联网） */
	isReady(): boolean {
		const { baseUrl, model } = this.state;
		const needsKey = providerRequiresKey(this.state.provider, baseUrl);
		return Boolean(baseUrl.trim() && model.trim() && (!needsKey || this.getApiKey().trim()));
	}

	/** 当前服务商的 Key */
	getApiKey(provider: AgentProvider = this.state.provider): string {
		return this.state.apiKeys[provider] ?? "";
	}

	/** 当前服务商缺不缺 Key（缺了要提示用户去设置） */
	needsApiKey(): boolean {
		const needsKey = providerRequiresKey(this.state.provider, this.state.baseUrl);
		return needsKey && !this.getApiKey().trim();
	}

	/** 切换服务商：地址和模型跟到预置值，Key 用该服务商自己的那份 */
	setProvider(provider: AgentProvider) {
		const preset = getProviderPreset(provider);
		this.commit({
			...this.state,
			provider,
			baseUrl: preset.baseUrl || this.state.baseUrl,
			model: preset.models[0] ?? this.state.model,
		});
	}

	setBaseUrl(baseUrl: string) {
		this.commit({ ...this.state, baseUrl });
	}

	setModel(model: string) {
		this.commit({ ...this.state, model });
	}

	/** 只改当前服务商的 Key，别串到别的服务商去 */
	setApiKey(apiKey: string) {
		this.commit({
			...this.state,
			apiKeys: { ...this.state.apiKeys, [this.state.provider]: apiKey },
		});
	}

	setGenerateImages(generateImages: boolean) {
		this.commit({ ...this.state, generateImages });
	}

	/** 启动时从偏好文件恢复 */
	replace(settings: Partial<AgentSettings> | null | undefined) {
		if (!settings) {
			return;
		}
		const provider = settings.provider ?? this.state.provider;
		const apiKeys: Record<AgentProvider, string> = {
			...EMPTY_KEYS,
			...this.state.apiKeys,
			...(settings.apiKeys ?? {}),
		};
		// 兼容旧格式：单个 apiKey 字段归到它当时所属的服务商
		const legacyKey = (settings as { apiKey?: unknown }).apiKey;
		if (typeof legacyKey === "string" && legacyKey && !apiKeys[provider]) {
			apiKeys[provider] = legacyKey;
		}
		this.commit({
			provider,
			baseUrl: settings.baseUrl ?? this.state.baseUrl,
			model: settings.model ?? this.state.model,
			apiKeys,
			generateImages: settings.generateImages ?? this.state.generateImages,
		});
	}

	private commit(next: AgentSettings) {
		const sameKeys =
			next.apiKeys.deepseek === this.state.apiKeys.deepseek &&
			next.apiKeys.openai === this.state.apiKeys.openai &&
			next.apiKeys.custom === this.state.apiKeys.custom;
		if (
			next.provider === this.state.provider &&
			next.baseUrl === this.state.baseUrl &&
			next.model === this.state.model &&
			sameKeys &&
			next.generateImages === this.state.generateImages
		) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const agentStore = new AgentStore();
