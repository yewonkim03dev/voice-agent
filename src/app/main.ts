import { KeywordCommandRouter } from "../router/KeywordCommandRouter.ts";

const router = new KeywordCommandRouter();

console.log("Voice Agent MVP core is ready.");
console.log("Run `npm test` to verify router, permission, safety, and runtime behavior.");
console.log(`Router loaded: ${router.constructor.name}`);
