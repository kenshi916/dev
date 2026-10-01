import {
  AppError,
  change,
  fail,
  one,
  setSetting,
  uploadPinata,
  userId,
} from "../../server/core";
export async function POST(request: Request) {
  try {
    const owner = await userId();
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new AppError("Request origin is not allowed.", 403);
    if (Number(request.headers.get("content-length")) > 2200000)
      throw new AppError("Image must be smaller than 2 MB.");
    const form = await request.formData(),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 2000000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw new AppError("Use a PNG, JPG, or WebP image up to 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid =
      file.type === "image/png"
        ? bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71
        : file.type === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216
          : bytes[0] === 82 &&
            bytes[1] === 73 &&
            bytes[8] === 87 &&
            bytes[9] === 69;
    if (!valid)
      throw new AppError("File contents do not match the image format.");
    const draftId = form.get("draftId");
    if (draftId) {
      const d = await one(
        "SELECT signature,status FROM drafts WHERE id=? AND owner=?",
        draftId,
        owner,
      );
      if (!d || d.signature || d.status === "preparing")
        throw new AppError("Only unsubmitted proposals can be edited.");
    }
    const url = await uploadPinata(owner, file);
    if (draftId)
      await change(
        "UPDATE drafts SET image_url=?,metadata_uri=NULL,prepared=NULL WHERE id=? AND owner=?",
        url,
        draftId,
        owner,
      );
    else await setSetting(owner, "session_image", url);
    return Response.json({ url });
  } catch (e) {
    return fail(e);
  }
}
