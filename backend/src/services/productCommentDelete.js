// backend/src/services/productCommentDelete.js

/*
 * Ștergere comentariu de produs (Întrebări & comentarii) - sursă unică,
 * folosită de ruta autorului (commentProductRoutes.js) și de ruta de
 * admin (adminMaintenanceRoutes.js).
 *
 * Comment.parentId NU are relație/FK în schema Prisma, deci ștergerea
 * unei întrebări principale nu ar șterge automat răspunsurile - le
 * ștergem explicit aici (împreună cu raportările lor), ca să nu rămână
 * răspunsuri orfane. Ștergerea unui răspuns șterge doar răspunsul.
 * CommentEditLog se șterge prin cascadă (relație onDelete: Cascade).
 */
export async function deleteProductCommentWithReplies(db, comment) {
  const commentId = comment.id;

  const replyIds = comment.parentId
    ? []
    : (
        await db.comment.findMany({
          where: { parentId: commentId },
          select: { id: true },
        })
      ).map((r) => r.id);

  const ids = [commentId, ...replyIds];

  await db.$transaction([
    db.commentReport.deleteMany({ where: { commentId: { in: ids } } }),
    ...(replyIds.length
      ? [db.comment.deleteMany({ where: { id: { in: replyIds } } })]
      : []),
    db.comment.delete({ where: { id: commentId } }),
  ]);

  return { deletedReplies: replyIds.length };
}
