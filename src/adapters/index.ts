import type { JobPortalAdapter } from "./JobPortalAdapter.js";
import { AccentureAdapter } from "./AccentureAdapter.js";
import { BkaAdapter } from "./BkaAdapter.js";
import { BndAdapter } from "./BndAdapter.js";
import { BwiAdapter } from "./BwiAdapter.js";
import { InteramtAdapter } from "./InteramtAdapter.js";
import { ItzBundAdapter } from "./ItzBundAdapter.js";

/** Alle verfügbaren Adapter. Neue Portale hier registrieren. */
export function createAdapters(): JobPortalAdapter[] {
  return [
    new ItzBundAdapter(),
    new BkaAdapter(),
    new BwiAdapter(),
    new BndAdapter(),
    new InteramtAdapter(),
    new AccentureAdapter(),
  ];
}
