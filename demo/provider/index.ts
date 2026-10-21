// DEMO ONLY. A deterministic fake model for recording screenshots/GIFs without a paid model.
//
//   PI_DEMO_SCENARIO=<name>   which demo/provider/scenarios/<name>.js to replay
//   PI_DEMO_SPEED=<n>         time multiplier (2 = twice as fast; default 1)
//   PI_DEMO_PROVIDER=<id>     provider id to register (default "demo"; statusline demo uses "openai-codex" to get quota bars)
//
// A scenario is { turns: Step[][], complete?: string }. Each user prompt consumes the next entry of
// `turns`; each model request inside that prompt (one per tool round-trip) consumes the next Step.
//   Step = { wait?, think?, text?, tools?: [[name, args], ...] }
// A step without `tools` ends the run. `complete` is the reply to side requests that carry no tools
// (e.g. /handoff summarisation).
import {
  type AssistantMessage,
  calculateCost,
  createAssistantMessageEventStream,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const path = require("node:path");

const SPEED = Math.max(0.1, Number(process.env.PI_DEMO_SPEED) || 1);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / SPEED));

function loadScenario(): any {
  const name = process.env.PI_DEMO_SCENARIO || "hero";
  return require(path.join(__dirname, "scenarios", `${name}.js`));
}

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export default function (pi: ExtensionAPI) {
  const scenario = loadScenario();
  let turn = -1;
  let step = 0;
  let toolSeq = 0;

  function streamDemo(model: any, context: any, options?: any) {
    const stream = createAssistantMessageEventStream();
    const tools = getCurrentTools(context.messages) ?? [];
    const last = context.messages[context.messages.length - 1];

    (async () => {
      const output: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "pending" as any,
        timestamp: Date.now(),
      };
      const aborted = () => options?.signal?.aborted;
      try {
        let current: any;
        let side = false;
        if (tools.length === 0 && scenario.complete) {
          side = true;
          current = { wait: 700, text: scenario.complete };
        } else {
          if (last?.role === "toolResult") step++;
          else {
            turn++;
            step = 0;
          }
          const steps = scenario.turns[turn] ?? [{ text: "(demo scenario has no more scripted turns)" }];
          current = steps[Math.min(step, steps.length - 1)];
        }

        await sleep(current.wait ?? 500);
        if (aborted()) throw new Error("aborted");
        stream.push({ type: "start", partial: output });

        if (current.think) {
          output.content.push({ type: "thinking", thinking: "" } as any);
          const i = output.content.length - 1;
          stream.push({ type: "thinking_start", contentIndex: i, partial: output });
          for (const c of chunks(current.think, 8)) {
            (output.content[i] as any).thinking += c;
            stream.push({ type: "thinking_delta", contentIndex: i, delta: c, partial: output });
            await sleep(12);
          }
          stream.push({ type: "thinking_end", contentIndex: i, content: current.think, partial: output });
        }

        if (current.text) {
          output.content.push({ type: "text", text: "" });
          const i = output.content.length - 1;
          stream.push({ type: "text_start", contentIndex: i, partial: output });
          for (const c of chunks(current.text, 4)) {
            (output.content[i] as any).text += c;
            stream.push({ type: "text_delta", contentIndex: i, delta: c, partial: output });
            await sleep(side ? 4 : 14);
            if (aborted()) throw new Error("aborted");
          }
          stream.push({ type: "text_end", contentIndex: i, content: current.text, partial: output });
        }

        for (const [name, args] of current.tools ?? []) {
          const call: any = { type: "toolCall", id: `demo_${++toolSeq}`, name, arguments: {} };
          output.content.push(call);
          const i = output.content.length - 1;
          stream.push({ type: "toolcall_start", contentIndex: i, partial: output });
          const json = JSON.stringify(args);
          for (const c of chunks(json, 24)) {
            stream.push({ type: "toolcall_delta", contentIndex: i, delta: c, partial: output });
            await sleep(25);
          }
          call.arguments = args;
          stream.push({ type: "toolcall_end", contentIndex: i, toolCall: call, partial: output });
        }

        const used = JSON.stringify(output.content).length;
        output.usage.input = 1800 + 600 * Math.max(0, step);
        output.usage.output = Math.ceil(used / 4);
        output.usage.totalTokens = output.usage.input + output.usage.output;
        calculateCost(model, output.usage);
        output.stopReason = (current.tools?.length ? "toolUse" : "stop") as any;
        stream.push({ type: "done", reason: output.stopReason as any, message: output });
        stream.end();
      } catch (error: any) {
        output.stopReason = (aborted() ? "aborted" : "error") as any;
        output.errorMessage = error?.message ?? String(error);
        stream.push({ type: "error", reason: output.stopReason as any, error: output });
        stream.end();
      }
    })();

    return stream;
  }

  pi.registerProvider(process.env.PI_DEMO_PROVIDER || "demo", {
    baseUrl: "http://localhost:0",
    apiKey: "demo",
    api: "demo-api",
    models: [
      {
        id: "demo",
        name: "Demo Model",
        reasoning: true,
        input: ["text"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ],
    streamSimple: streamDemo,
  });
}
