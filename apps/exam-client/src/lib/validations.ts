import { z } from "zod"

export const loginSchema = z.object({
  rollNumber: z
    .string()
    .min(1, "Application ID is required"),
  password: z
    .string()
    .min(1, "Password is required"),
})

export type LoginFormData = z.infer<typeof loginSchema>
