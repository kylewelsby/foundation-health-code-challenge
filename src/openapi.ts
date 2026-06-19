import { MAX_UPLOAD_LABEL } from "./lib/limits";

/** OpenAPI 3.1 description of the API, served at GET /openapi.json and rendered at /docs. */
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "MP3 Frame Analysis API",
    version: "1.0.0",
    description:
      "Counts MPEG-1 Audio Layer III frames in an uploaded MP3. `frameCount` excludes the " +
      "Xing/Info/VBRI header frame (matches mediainfo/ffprobe). See the repository ADRs for the rationale.",
  },
  paths: {
    "/file-upload": {
      post: {
        summary: "Count the frames in an MP3",
        description: `Multipart upload; send the MP3 as the \`file\` field. Max ${MAX_UPLOAD_LABEL}.`,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary", description: "The MP3 file" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Frame analysis",
            content: { "application/json": { schema: { $ref: "#/components/schemas/FrameAnalysis" } } },
          },
          "400": {
            description: "No file, empty file, or non-multipart body",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "413": {
            description: `Upload exceeds the ${MAX_UPLOAD_LABEL} limit`,
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "415": {
            description: "Not MPEG-1 Layer III (wrong version/layer, free-format, or not an MP3)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      FrameAnalysis: {
        type: "object",
        required: [
          "frameCount",
          "framesIncludingHeader",
          "durationSeconds",
          "sampleRate",
          "channelMode",
          "bitrate",
          "header",
          "flags",
        ],
        properties: {
          frameCount: { type: "integer", description: "Audio frames (excludes the header frame)", example: 6089 },
          framesIncludingHeader: { type: "integer", example: 6090 },
          durationSeconds: { type: "number", example: 159.0596 },
          sampleRate: { type: "integer", example: 44100 },
          channelMode: { type: "string", enum: ["stereo", "joint_stereo", "dual_channel", "mono"] },
          bitrate: {
            oneOf: [
              {
                type: "object",
                required: ["mode", "kbps"],
                properties: { mode: { const: "cbr" }, kbps: { type: "integer" } },
              },
              {
                type: "object",
                required: ["mode", "averageKbps"],
                properties: {
                  mode: { const: "vbr" },
                  averageKbps: { type: "integer" },
                },
              },
            ],
          },
          header: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: { type: "string", enum: ["xing", "info", "vbri", "none"] },
              declaredFrameCount: { type: "integer" },
            },
          },
          flags: {
            type: "object",
            required: ["truncated", "corrupt"],
            properties: { truncated: { type: "boolean" }, corrupt: { type: "boolean" } },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
  },
} as const;
