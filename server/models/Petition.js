const mongoose = require('mongoose');
const { softDeletePlugin } = require('../lib/softDelete');

const PetitionItemSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true },
    sampleName: { type: String, required: true },
    commonName: String,
    batchNo: String,
    lotNo: String,
    productionDate: String,
    submissionNo: String,
    packageUnit: String,
    testUnit: String,
    testItems: String,
    sendToLab: Boolean,
    note: String,
    sampleQuantity: { type: Number, default: 1 },
    labelManufacturer: String,
    labelSeller: String,
    labelQuantity: String,
    labelQuantities: [String],
    labelSampledBy: String,
    labelSampledDate: String,
    labelRemark: String,
    sampleId: String,
    // รหัส Master Item (item_no) ของแถวที่เลือก — คนละเรื่องกับ sampleId ซึ่งเป็น key
    // ของ Approval/PhysicalResult. ใช้ขับ "หมวดหมู่ย่อย (prefix code)" + "กลุ่ม Item"
    // ตอนจับคู่ parameter (ดู src/lib/petitionTestItems.ts)
    itemNo: String,
    condition: { type: String, enum: ['normal', 'defective'] },
  },
  { _id: false },
);

const SpecificGravitySchema = new mongoose.Schema(
  { seq: Number, sampleName: String, value: String },
  { _id: false },
);

const ReviewEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['note', 'approve', 'reject', 'startTesting', 'lab-approve', 'lab-reject', 'lab-recheck', 'additional-request'],
      required: true,
    },
    reviewedBy: { type: String, required: true },
    reviewedAt: { type: Date, required: true, default: Date.now },
    note: String,
    specificGravities: [SpecificGravitySchema],
  },
  { _id: false },
);

const PetitionAssigneeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },
    name: { type: String, required: true },
    department: String,
    position: String,
    assignedAt: { type: Date, default: Date.now },
    assignedBy: String,
    // เจ้าหน้าที่กดรับงานหลังหัวหน้า assign — เริ่มนับเวลาคาดว่าจะได้รับผลจากตรงนี้
    acceptedAt: Date,
    acceptedBy: String,
  },
  { _id: false },
);

const PetitionAssignedMachineSchema = new mongoose.Schema(
  {
    machineId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    location: String,
    // Substance identity — petition items sharing the same sampleName+commonName form
    // one substance group; each group is assigned its own machine(s).
    sampleName: String,
    commonName: String,
    standardTimeId: String,
    estimatedMinutes: Number,
    estimatedSource: String,
  },
  { _id: false },
);

const SubmittedBySchema = new mongoose.Schema(
  {
    employeeId: String,
    name: { type: String, required: true },
    email: String,
    department: String, // แผนกผู้ยื่น จาก HR/Microsoft
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const DeliveredBySchema = new mongoose.Schema(
  {
    employeeId: String,
    name: { type: String, required: true },
    email: String,
  },
  { _id: false },
);

const ProductionWorkflowSchema = new mongoose.Schema(
  {
    requestNo: { type: String, index: true },
    requesterEmail: String,
    lisPetitionNo: String,
    petitionNo: String,
    lisStatus: String,
    lisSent: Boolean,
    sentAt: Date,
  },
  { _id: false },
);

const PetitionSchema = new mongoose.Schema(
  {
    petitionNo: { type: String, required: true, index: true },
    dept: {
      type: String,
      enum: ['production', 'rm', 'fg'],
      required: true,
      index: true,
    },
    routeTargets: [{ type: String, enum: ['qc', 'lab'] }],
    status: {
      type: String,
      enum: ['deliveringQC', 'sampleSent', 'pendingReview', 'inProgress', 'success', 'approved', 'rejected'],
      default: 'deliveringQC',
      index: true,
    },
    // ลำดับความสำคัญของคำขอ (0 = ปกติ, ยิ่งมากยิ่งด่วน). ตอนนี้เก็บฝั่ง backend อย่างเดียว —
    // ยังไม่มี UI/route ให้แก้ค่านี้ ทุกคำขอจึงเป็น 0 จนกว่าจะเปิดใช้งานภายหลัง.
    priority: { type: Number, default: 0 },
    sampleSentAt: Date,
    receivedAt: Date,
    receivedBy: String,
    labReceivedAt: Date,
    labReceivedBy: String,
    qcReceivedAt: Date,
    qcReceivedBy: String,
    // Per-track completion ("บันทึกผล" pressed). Petition → success only when every
    // required track is done (QC always; Lab when there is a lab-batch item).
    labCompletedAt: Date,
    labCompletedBy: String,
    qcCompletedAt: Date,
    qcCompletedBy: String,
    // Lab supervisor approval (ด่านหลังผู้ทดสอบ Lab บันทึกผล — success เกิดหลังขั้นนี้)
    labApprovedAt: Date,
    labApprovedBy: String,
    // กด Re-check ฝั่ง Lab — คนที่มาทำซ้ำอีกวันอาจไม่ใช่คนเดิม งานจึงกลับไปโชว์บนบอร์ด
    // Assign ให้เปลี่ยนผู้รับงานได้ จนกว่าหัวหน้า Lab ออกผล (labApprovedAt ใหม่กว่า)
    labRecheckRequestedAt: Date,
    labRecheckRequestedBy: String,
    labRecheckReason: String,
    labRecheckCount: { type: Number, default: 0 },
    // แก้ไขผล Lab ที่บันทึกแล้ว: snapshot ก่อนแก้ (ใช้คืนค่าตอนยกเลิก + เก็บ log ค่าเดิม)
    labEditSession: { type: mongoose.Schema.Types.Mixed, default: null },
    // เหตุผลล่าสุดที่ track ถูกส่งกลับ (เคลียร์เมื่อผู้ทดสอบ re-confirm)
    labReturnNote: String,
    qcReturnNote: String,
    // ผู้ทดสอบอธิบาย "ทำใหม่ยังไง" ตอน re-confirm หลังโดนส่งกลับ
    labRedoExplanation: String,
    qcRedoExplanation: String,
    firstResultAt: Date,
    completedAt: Date,
    // ผลสรุปสุดท้ายจากหัวหน้า QC (ไว้แสดงในหน้าผลวิเคราะห์)
    //  pass                  = ผลปกติ-ถูกต้อง อนุมัติ
    //  accepted-oos          = ยอมรับผลไม่ปกติเป็นผลจริง (ต้องมีเหตุผล)
    //  returned-to-requester = ส่งคืนผู้ส่งให้แก้ product (ปิดงาน)
    conclusion: {
      type: String,
      enum: ['pass', 'accepted-oos', 'returned-to-requester'],
      default: null,
    },
    conclusionNote: String,
    submittedBy: { type: SubmittedBySchema, required: true },
    deliveredBy: { type: DeliveredBySchema },
    items: { type: [PetitionItemSchema], default: [] },
    cause: String,
    reviewHistory: { type: [ReviewEntrySchema], default: [] },
    assignedTo: PetitionAssigneeSchema,
    assignedMachines: { type: [PetitionAssignedMachineSchema], default: [] },
    // เวลาที่คาดว่าจะได้รับผล Lab — บันทึกตอนกด "เริ่มงาน" / เปลี่ยนเครื่อง / Re-check
    // { startedAt, at, minutes, estimated, basis: [{ code, name, minutes, source: 'standard'|'default', ... }] }
    labExpected: { type: mongoose.Schema.Types.Mixed, default: null },
    prodOrderNos: { type: [String], default: [], index: true },
    productionWorkflow: ProductionWorkflowSchema,
    additionalSampleRequests: {
      type: [new mongoose.Schema({
        qrCode: { type: String, required: true },
        side: { type: String, enum: ['qc', 'lab'], required: true },
        reason: { type: String, required: true, maxlength: 2000 },
        items: { type: [new mongoose.Schema({
          itemSeq: { type: Number, required: true },
          quantity: { type: Number, required: true, min: 1, max: 1000, validate: Number.isInteger },
          weights: {
            type: [{ type: Number, min: 1, validate: Number.isSafeInteger }],
            default: undefined,
            validate: {
              validator: function (weights) { return weights === undefined || (Array.isArray(weights) && weights.length === this.quantity); },
              message: 'กรุณาเลือกน้ำหนักให้ครบทุกตัวอย่าง',
            },
          },
        }, { _id: false })], required: true },
        requestedAt: { type: Date, required: true },
        requestedBy: { name: String, email: String, employeeId: String },
        status: { type: String, enum: ['requested', 'sent', 'received'], default: 'requested' },
        sentAt: Date,
        sentBy: { name: String, email: String, employeeId: String },
        receivedAt: Date,
        receivedBy: { name: String, email: String, employeeId: String },
        previousResults: { type: [mongoose.Schema.Types.Mixed], default: [] },
        currentPhase: { type: Number, enum: [1, 2], default: 1 },
        phase2DueAt: { type: Date, default: null },
        phase2UnlockedAt: { type: Date, default: null },
        phase2TriggeredBy: { type: mongoose.Schema.Types.Mixed, default: null },
      })],
      default: [],
    },

    // 2-phase testing — used when at least one parameter on this petition has hasPhases=true
    currentPhase: { type: Number, enum: [1, 2], default: 1, index: true },
    phase2UnlockedAt: { type: Date, default: null },
    phase2DueAt: { type: Date, default: null },
    phase2TriggeredBy: {
      type: new mongoose.Schema(
        {
          parameterId: String,
          parameterName: String,
          fieldLabel: String,
          itemSeq: Number,
          triggeredAt: Date,
          side: { type: String, enum: ['qc', 'lab'] },
        },
        { _id: false },
      ),
      default: null,
    },
    revisionOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Petition',
      default: null,
      index: true,
    },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

PetitionSchema.index({ petitionNo: 1, deletedAt: 1 }, { unique: true });
PetitionSchema.index({ 'additionalSampleRequests.qrCode': 1 }, { sparse: true });

PetitionSchema.plugin(softDeletePlugin);
module.exports = mongoose.model('Petition', PetitionSchema);
