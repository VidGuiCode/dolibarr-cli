import { describe, it, expect } from "vitest";
import type { Command } from "commander";
import {
  buildProposalLineBody,
  createProposalsCommand,
} from "../../src/commands/proposals.js";

function sub(cmd: Command, name: string): Command | undefined {
  return cmd.commands.find((c) => c.name() === name);
}

describe("proposals command", () => {
  const cmd = createProposalsCommand();

  it("registers update-line and delete-line", () => {
    expect(sub(cmd, "update-line")).toBeDefined();
    expect(sub(cmd, "delete-line")).toBeDefined();
  });

  it("builds a proposal line body with numeric coercion", () => {
    expect(buildProposalLineBody({ subprice: "40", qty: "2", tvaTx: "17", productType: "1" })).toEqual({
      subprice: 40,
      qty: 2,
      tva_tx: 17,
      product_type: 1,
    });
  });

  it("only includes passed line flags", () => {
    expect(buildProposalLineBody({ qty: "5" })).toEqual({ qty: 5 });
  });
});
