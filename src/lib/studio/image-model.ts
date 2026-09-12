/** Shared classification for the image families exposed by the current gateway. */
export function isImageGenerationModel(model: string): boolean {
  return /(?:^|[-_/])(image|images|imagen|dall-e|flux|banana)(?:[-_/.]|$)/i.test(model);
}
