// The measured "greatest speed" family, rebuilt by hand with textbook names.
import type { Relation } from "../../src/map.ts";

export const graphNode = (id: string, name: string, chatId = "chat_fm1") =>
	({ id, name, statement: `${name}.`, aliases: [], createdAt: "2026-01-05T10:00:00.000Z", provenance: [{ chatId, messageId: "msg_1" }] });
export const graphChain = (id: string, premises: string[], conclusion: string) =>
	({ id, premises, conclusion, provenance: [{ chatId: "chat_fm1", messageId: "msg_1" }], createdAt: "2026-01-05T10:00:00.000Z" });
let serial = 0;
export const relation = (from: string, to: string): Relation => ({ id: `rel_${++serial}`, from, to, createdAt: "2026-01-05T10:00:00.000Z" });

export const familyNodes = [
	graphNode("n_momentum", "Newton's second law (momentum form)"),
	graphNode("n_deriv", "Velocity and acceleration as derivatives"),
	graphNode("n_fma", "F = ma for constant mass"),
	graphNode("n_stationary", "Stationary point of a differentiable function"),
	graphNode("n_zero_acc", "Zero acceleration at maximum velocity"),
	graphNode("n_power", "Power of a driving force", "chat_review"),
	graphNode("n_greatest", "Greatest speed under constant power"),
	graphNode("n_work", "Work–energy principle"),
	{ ...graphNode("n_fma", "F equals m a"), createdAt: "2026-01-06T10:00:00.000Z" }, // a later line: an alias
];
export const familyChains = [
	graphChain("c_fma", ["n_momentum", "n_deriv"], "n_fma"),
	graphChain("c_zero", ["n_stationary", "n_deriv"], "n_zero_acc"),
	graphChain("c_greatest", ["n_zero_acc", "n_power"], "n_greatest"),
	graphChain("c_work", ["n_fma"], "n_work"),
];
export const familyRelations = [
	relation("n_fma", "n_momentum"), relation("n_fma", "n_deriv"),
	relation("n_zero_acc", "n_stationary"), relation("n_zero_acc", "n_deriv"), relation("n_zero_acc", "n_fma"),
	relation("n_greatest", "n_zero_acc"), relation("n_greatest", "n_fma"), relation("n_greatest", "n_power"),
	relation("n_greatest", "n_gone"),
];
