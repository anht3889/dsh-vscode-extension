import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandDescriptor } from "@deepseek-ai/dsh-commands";
import type {
  SkillSummary,
  SkillViewOptions,
} from "@deepseek-ai/dsh-skill";
import type { OutboundMessage } from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import { createSlashCatalog } from "./slash-catalog.js";

interface Services {
  commands?: {
    list(agent: Agent): readonly CommandDescriptor[];
  };
  skills?: {
    list(options?: SkillViewOptions): Promise<SkillSummary[]>;
  };
}

function context(services: Services): Context {
  return {
    get(name: keyof Services) {
      return services[name];
    },
  } as unknown as Context;
}

function agent(cwd: string): Agent {
  return {
    session: { header: { cwd } },
  } as unknown as Agent;
}

function skill(
  name: string,
  description: string,
  userInvocable: boolean,
): SkillSummary {
  return {
    name,
    description,
    invocation: { modelInvocable: true, userInvocable },
    source: "runtime",
    provider: "test",
  };
}

function slashMessages(send: ReturnType<typeof vi.fn>): OutboundMessage[] {
  return send.mock.calls.map(([message]) => message as OutboundMessage);
}

describe("createSlashCatalog", () => {
  it("normalizes the current agent's commands and user-invocable skills", async () => {
    const current = agent("/workspace/current");
    const commands = {
      list: vi.fn(() => [
        { name: "compact", description: "Compact context" },
        {
          name: "goal",
          description: "Set the goal",
          input: { hint: "<objective>", images: true },
        },
        { name: "brainstorming", description: "Command collision" },
      ]),
    };
    const skills = {
      list: vi.fn(async () => [
        skill("brainstorming", "Design first", true),
        skill("internal", "Hidden", false),
      ]),
    };
    const send = vi.fn();
    const catalog = createSlashCatalog(
      context({ commands, skills }),
      () => current,
      send,
    );

    catalog.list("r1");

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(commands.list).toHaveBeenCalledWith(current);
    expect(skills.list).toHaveBeenCalledWith({
      cwd: "/workspace/current",
      scope: current,
      signal: expect.any(AbortSignal),
    });
    expect(slashMessages(send)).toEqual([
      {
        kind: "slashItems",
        requestId: "r1",
        items: [
          {
            source: "command",
            name: "compact",
            description: "Compact context",
            behavior: "execute",
          },
          {
            source: "command",
            name: "goal",
            description: "Set the goal",
            behavior: "command-input",
            hint: "<objective>",
            acceptsImages: true,
          },
          {
            source: "command",
            name: "brainstorming",
            description: "Command collision",
            behavior: "execute",
          },
          {
            source: "skill",
            name: "brainstorming",
            description: "Design first",
            behavior: "insert",
          },
        ],
        availability: { commands: true, skills: true },
      },
    ]);
  });

  it("keeps skills available when command discovery fails", async () => {
    const current = agent("/workspace");
    const send = vi.fn();
    const catalog = createSlashCatalog(
      context({
        commands: {
          list() {
            throw new Error("commands unavailable");
          },
        },
        skills: {
          async list() {
            return [skill("brainstorming", "Design first", true)];
          },
        },
      }),
      () => current,
      send,
    );

    catalog.list("r1");

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(slashMessages(send)[0]).toEqual({
      kind: "slashItems",
      requestId: "r1",
      items: [
        {
          source: "skill",
          name: "brainstorming",
          description: "Design first",
          behavior: "insert",
        },
      ],
      availability: { commands: false, skills: true },
    });
  });

  it("keeps commands available when skill discovery fails", async () => {
    const current = agent("/workspace");
    const send = vi.fn();
    const catalog = createSlashCatalog(
      context({
        commands: {
          list() {
            return [{ name: "compact", description: "Compact context" }];
          },
        },
        skills: {
          async list() {
            throw new Error("skills unavailable");
          },
        },
      }),
      () => current,
      send,
    );

    catalog.list("r1");

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(slashMessages(send)[0]).toEqual({
      kind: "slashItems",
      requestId: "r1",
      items: [
        {
          source: "command",
          name: "compact",
          description: "Compact context",
          behavior: "execute",
        },
      ],
      availability: { commands: true, skills: false },
    });
  });

  it("aborts and suppresses a stale open when a newer open starts", async () => {
    const pending: {
      options: SkillViewOptions;
      resolve: (skills: SkillSummary[]) => void;
    }[] = [];
    const current = agent("/workspace");
    const send = vi.fn();
    const catalog = createSlashCatalog(
      context({
        skills: {
          list(options = {}) {
            return new Promise<SkillSummary[]>((resolve) => {
              pending.push({ options, resolve });
            });
          },
        },
      }),
      () => current,
      send,
    );

    catalog.list("r1");
    catalog.list("r2");

    expect(pending).toHaveLength(2);
    expect(pending[0]?.options.signal?.aborted).toBe(true);
    pending[1]!.resolve([skill("newest", "Newest result", true)]);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    pending[0]!.resolve([skill("stale", "Stale result", true)]);
    await Promise.resolve();

    expect(slashMessages(send)).toEqual([
      {
        kind: "slashItems",
        requestId: "r2",
        items: [
          {
            source: "skill",
            name: "newest",
            description: "Newest result",
            behavior: "insert",
          },
        ],
        availability: { commands: false, skills: true },
      },
    ]);
  });

  it("suppresses a request started during live-agent replacement", async () => {
    let resolveSkills: (skills: SkillSummary[]) => void = () => {};
    const oldAgent = agent("/workspace/old");
    const newAgent = agent("/workspace/new");
    let liveAgent = oldAgent;
    const send = vi.fn();
    const catalog = createSlashCatalog(
      context({
        skills: {
          list() {
            return new Promise<SkillSummary[]>((resolve) => {
              resolveSkills = resolve;
            });
          },
        },
      }),
      () => liveAgent,
      send,
    );

    catalog.dispose();
    catalog.list("during-replacement");
    liveAgent = newAgent;
    resolveSkills([skill("stale", "Old session result", true)]);
    await Promise.resolve();

    expect(send).not.toHaveBeenCalled();
  });
});
