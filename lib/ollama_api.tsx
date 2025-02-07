// Types for API responses and requests
import { produce } from 'immer';

import { ChatResponse, ChatRequest, PullRequest, GenerateResponse, GenerateRequest, ListResponse, ModelResponse } from "ollama";

export enum MessageRole {
  USER = 'user',
  SYSTEM = 'system',
  ASSISTANT = 'assistant'
}


class OllamaAPI {
  private baseURL: string;
  private abortController: AbortController | null = null;

  constructor(host: string = 'http://localhost:11434') {
    this.baseURL = host.replace(/\/$/, '');
  }
  cancelRequest() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  private async fetchWithError(endpoint: string, options): Promise<any> {

    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `HTTP error! status: ${response.status}`);
      }

      return response;
    } catch (error) {
      console.error(`Error in Ollama API call to ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Chat with a model using message history
   */
  async chat(request: ChatRequest, onProgress?: (response: ChatResponse) => void): Promise<ChatResponse | void> {
    const { stream = true } = request
    if (stream) {
      return await this.chatWithStream(request, onProgress)
    } else {
      return await this.chatGenerate(request)
    }
  }

  async chatGenerate(request: ChatRequest): Promise<ChatResponse | void> {
    const response = await this.fetchWithError('/api/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return response.json()
  }

  async chatWithStream(request: ChatRequest, onProgress?: (response: ChatResponse) => void): Promise<ChatResponse | void> {
    const response = await this.fetchWithError('/api/chat', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let finalResponse: ChatResponse | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const parsedResponse = JSON.parse(line) as ChatResponse;

            const nextResponse = produce(parsedResponse, draft => {
              draft.message.content = (finalResponse?.message.content || "") + draft.message.content;
            });
            finalResponse = nextResponse;
            onProgress?.(nextResponse);
          } catch (e) {
            console.warn('Failed to parse streaming response:', e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return finalResponse;
  }

  /**
   * Generate a response from a prompt
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return this.fetchWithError('/api/generate', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * List all available models
   */
  async list(): Promise<ListResponse> {
    const response = await this.fetchWithError('/api/tags', {
      method: 'GET',
    });
    return response.json();
  }

  /**
   * Pull a model from the Ollama library
   */
  async pull(request: PullRequest): Promise<ModelResponse> {
    const response = await this.fetchWithError('/api/pull', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return response.json();

  }

  /**
   * Get information about a specific model
   */
  async modelInfo(modelName: string): Promise<ModelResponse> {
    const response = await this.fetchWithError('/api/show', {
      method: 'POST',
      body: JSON.stringify({ name: modelName }),
    });
    return response.json();
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    await this.fetchWithError('/api/delete', {
      method: 'DELETE',
      body: JSON.stringify({ name: modelName }),
    });
  }

  /**
   * Copy a model
   */
  async copyModel(source: string, destination: string): Promise<void> {
    await this.fetchWithError('/api/copy', {
      method: 'POST',
      body: JSON.stringify({ source, destination }),
    });
  }

  /**
   * Create a model from a Modelfile
   */
  async createModel(modelName: string, modelfile: string): Promise<void> {
    await this.fetchWithError('/api/create', {
      method: 'POST',
      body: JSON.stringify({ name: modelName, modelfile }),
    });
  }

  async checkHealth(timeout: number = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.baseURL}/api/version`, {
        signal: controller.signal,
        method: 'GET',
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

export const ollama = new OllamaAPI();

export default OllamaAPI;