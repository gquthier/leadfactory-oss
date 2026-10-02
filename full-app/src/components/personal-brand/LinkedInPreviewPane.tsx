"use client";

import { Linkedin, ThumbsUp, MessageCircle, Repeat2, Send } from "lucide-react";

interface Props {
  body: string;
  authorName?: string | null;
  authorPicture?: string | null;
  authorSubtitle?: string;
}

const FOLD_CHARS = 210;

export function LinkedInPreviewPane({
  body,
  authorName,
  authorPicture,
  authorSubtitle = "Vous · Maintenant",
}: Props) {
  const empty = body.trim().length === 0;
  const visible = empty
    ? "(Votre post apparaîtra ici)"
    : body.length > FOLD_CHARS
      ? body.slice(0, FOLD_CHARS)
      : body;
  const hasMore = !empty && body.length > FOLD_CHARS;

  return (
    <div className="border-3 border-black bg-white">
      <div className="p-3 border-b-2 border-black bg-canvas flex items-center gap-2">
        <Linkedin className="w-4 h-4 text-[#0A66C2]" />
        <span className="text-xs font-black uppercase tracking-wider">
          Aperçu LinkedIn
        </span>
      </div>

      <div className="p-3">
        {/* Author row */}
        <div className="flex items-center gap-2 mb-3">
          {authorPicture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={authorPicture}
              alt={authorName ?? "profil"}
              className="w-10 h-10 rounded-full border-2 border-black object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#0A66C2] border-2 border-black flex items-center justify-center">
              <Linkedin className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-black">{authorName ?? "Votre nom"}</span>
            <span className="text-[11px] text-lf-gray">{authorSubtitle}</span>
          </div>
        </div>

        {/* Body */}
        <div className="text-sm font-sans whitespace-pre-wrap leading-relaxed">
          {visible}
          {hasMore && (
            <>
              <span className="text-lf-gray"> …</span>
              <div className="mt-1 text-[#0A66C2] text-xs font-bold cursor-default">
                voir plus
              </div>
            </>
          )}
        </div>

        {/* Engagement bar mock */}
        <div className="mt-4 pt-3 border-t-2 border-gray-200 flex items-center justify-around text-lf-gray text-[11px] font-bold">
          <span className="flex items-center gap-1">
            <ThumbsUp className="w-3.5 h-3.5" /> J&apos;aime
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="w-3.5 h-3.5" /> Commenter
          </span>
          <span className="flex items-center gap-1">
            <Repeat2 className="w-3.5 h-3.5" /> Republier
          </span>
          <span className="flex items-center gap-1">
            <Send className="w-3.5 h-3.5" /> Envoyer
          </span>
        </div>
      </div>
    </div>
  );
}
