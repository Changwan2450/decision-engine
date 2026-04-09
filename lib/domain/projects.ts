import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Project = z.infer<typeof projectSchema>;

export function createProject(input: {
  id: string;
  name: string;
  description: string;
  now: string;
}): Project {
  return projectSchema.parse({
    id: input.id,
    name: input.name,
    description: input.description,
    createdAt: input.now,
    updatedAt: input.now
  });
}
