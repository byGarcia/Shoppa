import { makeLoginOptionsHandler } from "@/server/webauthn";
import { ApiResponse, handleApiError } from "@/lib/api-utils";

export const POST = makeLoginOptionsHandler({ ApiResponse, handleApiError });
