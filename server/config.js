export const PORT = parseInt(process.env.PORT || "8080", 10);
export const DEBUG = true;
export const MODEL_NAME = process.env.HUGGINGFACE_REPO_ID || "Qwen/Qwen2.5-7B-Instruct";
export const TEMPERATURE = parseFloat(process.env.HUGGINGFACE_TEMPERATURE || "0.2");
export const MAX_NEW_TOKENS = parseInt(process.env.HUGGINGFACE_MAX_NEW_TOKENS || "512", 10);
