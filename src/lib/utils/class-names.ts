import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 className，后者覆盖前者的同族工具类 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
