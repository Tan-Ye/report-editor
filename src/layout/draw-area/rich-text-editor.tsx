import { useEffect, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Extension, type JSONContent } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	ChevronDown,
	ChevronUp,
	Italic,
	Link2,
	List,
	ListOrdered,
	Strikethrough,
	Underline as UnderlineIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getActiveCanvas } from "@/lib/canvas-registry";
import { readElementInfo } from "@/lib/element/registry";
import { RichTextBox } from "@/lib/element/rich-object";
import {
	fromProseMirrorDoc,
	toProseMirrorDoc,
} from "@/lib/element/rich-tiptap";
import type { RichTextDoc } from "@/lib/element/rich-text";
import { elementObjectMap, historyStore, pageStore, toolStore, viewportStore } from "@/store";
import type { ViewportState } from "@/store";

/**
 * 富文本编辑覆盖层（Tiptap）。
 *
 * 画布上的 RichTextBox 是最终渲染；双击后把它隐藏，在原位置盖一个 DOM
 * 编辑器，编辑体验交给 ProseMirror。提交时把 ProseMirror 文档转回段落模型、
 * 写回对象和 store，只记一步历史。
 *
 * 覆盖层按元素的位置/宽度/角度/字号摆放，编辑态和画布尽量长得一样。
 */

interface EditGeometry {
	object: RichTextBox;
	zoom: number;
	left: number;
	top: number;
	width: number;
	height: number;
	angle: number;
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	color: string;
	doc: RichTextDoc;
	/** 覆盖层所在容器的尺寸：工具条要按它夹宽度，避免横向溢出 */
	viewportWidth: number;
}

function computeGeometry(elementId: string, viewport: ViewportState): EditGeometry | null {
	const object = elementObjectMap.getObject(elementId);
	if (!(object instanceof RichTextBox)) {
		return null;
	}
	const style = object.richStyle;
	const zoom = viewport.scale || 1;
	return {
		object,
		zoom,
		left: viewport.tx + zoom * object.left,
		top: viewport.ty + zoom * object.top,
		width: object.width * zoom,
		height: Math.max(object.height * zoom, style.fontSize * style.lineHeight * zoom),
		angle: object.angle ?? 0,
		fontSize: style.fontSize,
		fontFamily: style.fontFamily,
		lineHeight: style.lineHeight,
		color: object.textColor,
		doc: object.textDoc,
		viewportWidth: viewport.width,
	};
}

/** 段落缩进是自定义属性，用全局 attribute 挂在 paragraph 上 */
const IndentAttribute = Extension.create({
	name: "indentAttribute",
	addGlobalAttributes() {
		return [
			{
				types: ["paragraph"],
				attributes: {
					indent: {
						default: 0,
						parseHTML: (element) => Number(element.getAttribute("data-indent")) || 0,
						renderHTML: (attributes) => {
							const indent = Number(attributes.indent) || 0;
							if (indent <= 0) {
								return {};
							}
							return {
								"data-indent": String(indent),
								style: `text-indent:${indent}px`,
							};
						},
					},
				},
			},
		];
	},
});

export function RichTextEditor() {
	const editingId = useSyncExternalStore(toolStore.subscribe, toolStore.getEditingTextId);
	if (!editingId) {
		return null;
	}
	return <EditingSession key={editingId} elementId={editingId} />;
}

function EditingSession({ elementId }: { elementId: string }) {
	// 视口快照：编辑期间禁止缩放/平移，所以进入时算一次就够
	const [geometry] = useState(() => computeGeometry(elementId, viewportStore.getSnapshot()));

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: false,
				codeBlock: false,
				blockquote: false,
				horizontalRule: false,
				link: {
					openOnClick: false,
					autolink: true,
					HTMLAttributes: { rel: "noopener noreferrer", target: null },
				},
			}),
			TextAlign.configure({ types: ["paragraph"] }),
			TextStyle,
			Color.configure({ types: ["textStyle"] }),
			IndentAttribute,
		],
		content: (geometry ? toProseMirrorDoc(geometry.doc) : { type: "doc", content: [] }) as JSONContent,
		editorProps: {
			attributes: {
				class: "outline-none",
			},
		},
	});

	const toolbar = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			bold: current?.isActive("bold") ?? false,
			italic: current?.isActive("italic") ?? false,
			underline: current?.isActive("underline") ?? false,
			strike: current?.isActive("strike") ?? false,
			bullet: current?.isActive("bulletList") ?? false,
			ordered: current?.isActive("orderedList") ?? false,
			link: current?.isActive("link") ?? false,
			align: current?.getAttributes("paragraph").textAlign ?? "left",
			indent: Number(current?.getAttributes("paragraph").indent) || 0,
			color: String(current?.getAttributes("textStyle").color ?? ""),
		}),
	});

	useEffect(() => {
		if (!geometry) {
			toast.add({
				title: "打不开编辑器",
				description: "找不到这个文本元素，可能已经被删除或撤销",
				type: "warning",
			});
			toolStore.stopTextEditing();
			return;
		}
		const canvas = getActiveCanvas();
		geometry.object.visible = false;
		canvas?.requestRenderAll();
		const unsubscribePage = pageStore.subscribe(() => {
			toolStore.stopTextEditing();
		});
		return () => {
			unsubscribePage();
			geometry.object.visible = true;
			canvas?.requestRenderAll();
		};
	}, [geometry]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		// 打开就把光标放到最后，等一帧让 DOM 先挂上
		const timer = window.setTimeout(() => editor.commands.focus("end"), 0);
		return () => window.clearTimeout(timer);
	}, [editor]);

	const save = () => {
		if (!geometry || !editor) {
			toolStore.stopTextEditing();
			return;
		}
		const doc = fromProseMirrorDoc(editor.getJSON());
		geometry.object.setDoc(doc, { placeholder: false });
		const info = readElementInfo(geometry.object);
		if (info) {
			pageStore.updateElementInCurrentPage({
				...info,
				attrs: { ...info.attrs, text: geometry.object.text, paragraphs: doc },
			});
		}
		const canvas = getActiveCanvas();
		geometry.object.visible = true;
		canvas?.setActiveObject(geometry.object);
		canvas?.requestRenderAll();
		historyStore.commit();
		toolStore.stopTextEditing();
	};

	const cancel = () => {
		toolStore.stopTextEditing();
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				cancel();
				return;
			}
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				event.stopPropagation();
				save();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	});

	if (!geometry) {
		return null;
	}

	const applyIndent = (delta: number) => {
		if (!editor) {
			return;
		}
		const current = Number(editor.getAttributes("paragraph").indent) || 0;
		const next = Math.max(0, current + delta);
		editor.chain().focus().updateAttributes("paragraph", { indent: next }).run();
	};

	const setLink = () => {
		if (!editor) {
			return;
		}
		if (editor.isActive("link")) {
			editor.chain().focus().unsetLink().run();
			return;
		}
		const href = window.prompt("链接地址", "https://");
		if (!href) {
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
	};

	const stopToolbarMouseDown = (event: ReactMouseEvent) => event.preventDefault();

	// 工具条比元素宽：按容器剩余空间夹一下，元素靠近右/左边缘时也不溢出
	const toolbarWidth = Math.max(
		280,
		Math.min(Math.max(geometry.width, 520), geometry.viewportWidth - geometry.left - 16),
	);
	// 上方放不下就翻到编辑框下面
	const toolbarBelow = geometry.top < 56;
	// 工具条默认左对齐；靠近右边缘时改成右对齐，向元素左侧展开
	const toolbarAlignRight = geometry.left + toolbarWidth > geometry.viewportWidth - 8;

	return (
		<div className="pointer-events-none absolute inset-0 z-40">
			<div
				style={{
					position: "absolute",
					left: geometry.left,
					top: geometry.top,
					width: geometry.width,
					transform: `rotate(${geometry.angle}deg)`,
					transformOrigin: "0 0",
				}}
				className="pointer-events-auto"
			>
				<div
					className="absolute z-10 flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-1 shadow-md"
					style={{
						width: toolbarWidth,
						...(toolbarAlignRight ? { right: 0, left: "auto" } : { left: 0 }),
						...(toolbarBelow
							? { top: "calc(100% + 4px)" }
							: { bottom: "calc(100% + 4px)" }),
					}}
				>
					<ToolbarButton
						label="加粗"
						active={toolbar?.bold}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleBold().run()}
					>
						<Bold className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="斜体"
						active={toolbar?.italic}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleItalic().run()}
					>
						<Italic className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="下划线"
						active={toolbar?.underline}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleUnderline().run()}
					>
						<UnderlineIcon className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="删除线"
						active={toolbar?.strike}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleStrike().run()}
					>
						<Strikethrough className="size-3.5" />
					</ToolbarButton>

					<span className="mx-0.5 h-4 w-px bg-border" />

					<input
						type="color"
						title="文字颜色"
						className="size-5 cursor-pointer rounded border border-border bg-transparent p-0"
						value={toolbar?.color || "#111827"}
						onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
					/>
					<ToolbarButton
						label={toolbar?.link ? "移除链接" : "插入链接"}
						active={toolbar?.link}
						onMouseDown={stopToolbarMouseDown}
						onClick={setLink}
					>
						<Link2 className="size-3.5" />
					</ToolbarButton>

					<span className="mx-0.5 h-4 w-px bg-border" />

					<ToolbarButton
						label="项目符号"
						active={toolbar?.bullet}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleBulletList().run()}
					>
						<List className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="编号"
						active={toolbar?.ordered}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().toggleOrderedList().run()}
					>
						<ListOrdered className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="减少缩进"
						onMouseDown={stopToolbarMouseDown}
						onClick={() => applyIndent(-geometry.fontSize * 2)}
					>
						<ChevronUp className="size-3.5 -rotate-90" />
					</ToolbarButton>
					<ToolbarButton
						label="首行缩进"
						onMouseDown={stopToolbarMouseDown}
						onClick={() => applyIndent(geometry.fontSize * 2)}
					>
						<ChevronDown className="size-3.5 -rotate-90" />
					</ToolbarButton>

					<span className="mx-0.5 h-4 w-px bg-border" />

					<ToolbarButton
						label="左对齐"
						active={toolbar?.align === "left"}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().setTextAlign("left").run()}
					>
						<AlignLeft className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="居中"
						active={toolbar?.align === "center"}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().setTextAlign("center").run()}
					>
						<AlignCenter className="size-3.5" />
					</ToolbarButton>
					<ToolbarButton
						label="右对齐"
						active={toolbar?.align === "right"}
						onMouseDown={stopToolbarMouseDown}
						onClick={() => editor?.chain().focus().setTextAlign("right").run()}
					>
						<AlignRight className="size-3.5" />
					</ToolbarButton>

					<span className="ml-auto" />
					<Button type="button" size="xs" variant="ghost" onClick={cancel}>
						取消
					</Button>
					<Button type="button" size="xs" onClick={save}>
						完成
					</Button>
				</div>

				<div
					className="rounded-md border border-border bg-white shadow-lg"
					style={{
						width: geometry.width,
						maxHeight: "60vh",
						overflowY: "auto",
					}}
				>
					<EditorContent
						editor={editor}
						style={{
							fontSize: geometry.fontSize * geometry.zoom,
							fontFamily: geometry.fontFamily,
							lineHeight: geometry.lineHeight,
							color: geometry.color,
							// 编辑区和元素一样高，不再额外垫高
							minHeight: geometry.height,
						}}
						className="[&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0 [&_.ProseMirror_ul]:my-0 [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-0 [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline"
					/>
				</div>
			</div>
		</div>
	);
}

function ToolbarButton({
	label,
	active,
	onMouseDown,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	onMouseDown: (event: React.MouseEvent) => void;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button
			type="button"
			size="icon-sm"
			variant={active ? "secondary" : "ghost"}
			title={label}
			aria-label={label}
			onMouseDown={onMouseDown}
			onClick={onClick}
			className="size-6"
		>
			{children}
		</Button>
	);
}
