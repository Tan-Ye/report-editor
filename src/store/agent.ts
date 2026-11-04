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
	/** 接口根地址，例如 https://api.deepseek.com/v1 */
	baseUrl: string;
	/** 模型名，例如 deepseek-chat */
	model: string;
	apiKey: string;
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
		baseUrl: "https://api.deepseek.com/v1",
		models: ["deepseek-chat", "deepseek-reasoner"],
		// reasoner 系列对 function calling 支持有限，选了它 agent 只能聊天
		noTools: ["deepseek-reasoner"],
		note: "deepseek-chat 支持工具调用；reasoner 不支持，选了只能聊天",
	},
	{
		value: "openai",
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		models: ["gpt-4o-mini", "gpt-4o"],
	},
	{
		value: "custom",
		label: "自定义（OpenAI 兼容）",
		baseUrl: "",
		models: [],
		note: "填任意 OpenAI 兼容端点，例如本地 Ollama：http://localhost:11434/v1",
	},
];

export function getProviderPreset(provider: AgentProvider): AgentProviderPreset {
	return AGENT_PROVIDERS.find((item) => item.value === provider) ?? AGENT_PROVIDERS[0];
}

/** 这个模型能不能用工具调用 */
export function supportsTools(settings: AgentSettings): boolean {
	const preset = getProviderPreset(settings.provider);
	return !(preset.noTools ?? []).includes(settings.model);
}

const INITIAL: AgentSettings = {
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com/v1",
	model: "deepseek-chat",
	apiKey: "",
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
		const { baseUrl, model, apiKey } = this.state;
		return Boolean(baseUrl.trim() && model.trim() && apiKey.trim());
	}

	/** 切换服务商：地址和模型自动跟到预置值，Key 保留（用户可能用的是同一个） */
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

	setApiKey(apiKey: string) {
		this.commit({ ...this.state, apiKey });
	}

	setGenerateImages(generateImages: boolean) {
		this.commit({ ...this.state, generateImages });
	}

	/** 启动时从偏好文件恢复 */
	replace(settings: Partial<AgentSettings> | null | undefined) {
		if (!settings) {
			return;
		}
		this.commit({
			provider: settings.provider ?? this.state.provider,
			baseUrl: settings.baseUrl ?? this.state.baseUrl,
			model: settings.model ?? this.state.model,
			apiKey: settings.apiKey ?? this.state.apiKey,
			generateImages: settings.generateImages ?? this.state.generateImages,
		});
	}

	private commit(next: AgentSettings) {
		if (
			next.provider === this.state.provider &&
			next.baseUrl === this.state.baseUrl &&
			next.model === this.state.model &&
			next.apiKey === this.state.apiKey &&
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
