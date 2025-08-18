// backend/models/Invitation.js
import mongoose from "mongoose";

const InvitationSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Types.ObjectId, ref: "User", required: true },
  status:  { type: String, enum: ["draft","published"], default: "draft" },
  slug:    { type: String, unique: true, sparse: true },
  payload: {
    couple:   { bride: {type:String, default:""}, groom: {type:String, default:""} },
    date:     { type: String, default: "" },
    city:     { type: String, default: "" },
    ceremony: { name:String, address:String, time:String, mapUrl:String },
    party:    { name:String, address:String, time:String, mapUrl:String },
    rsvp:     { phone:String, deadline:String, link:String },
    faq:        [{ q:String, a:String }],
    parents:    [{ name:String, side:String, note:String }],
    godparents: [{ name:String, note:String }],
    storyHeadline: { type:String, default:"" },
  },
}, { timestamps: true });

export default mongoose.model("Invitation", InvitationSchema);
