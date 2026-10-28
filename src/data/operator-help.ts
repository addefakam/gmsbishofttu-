/**
 * Operator help articles — structured manual for the operator module.
 *
 * WHY STRUCTURED DATA (not LLM-generated)
 * - 100% accurate (you wrote it)
 * - No latency (no LLM call needed)
 * - No hallucination risk
 * - Translatable
 * - Searchable by keyword
 *
 * HOW TO EXTEND
 * Add new articles to the `helpArticles` array below. Each article has:
 *   - id: unique identifier
 *   - page: which sidebar page this is for (matches sidebar.tsx page keys)
 *   - title: localized title
 *   - keywords: search keywords across all 3 languages
 *   - steps: ordered list of step-by-step instructions
 *   - tips: optional tips/warnings
 *
 * The LLM fallback (when keyword search returns 0 matches) uses these
 * articles as its only source of truth — so keeping them complete and
 * accurate is critical.
 */

export type LocalizedString = {
  en: string;
  am: string;
  om: string;
};

export type HelpStep = {
  en: string;
  am: string;
  om: string;
};

export type HelpArticle = {
  id: string;
  page: string;
  title: LocalizedString;
  keywords: string[];
  steps: HelpStep[];
  tips?: LocalizedString[];
};

export const helpArticles: HelpArticle[] = [
  {
    id: "dashboard",
    page: "dashboard",
    title: {
      en: "Understanding the Dashboard",
      am: "ዳሽቦርዱን መረዳት",
      om: "Daashiboordii gabaasa",
    },
    keywords: ["dashboard", "overview", "stats", "home", "ዳሽቦርድ", "daashiboordii"],
    steps: [
      {
        en: "The Dashboard is your home page. It shows today's key numbers: total rooms, occupied, available, reservations.",
        am: "ዳሽቦርዱ የመነሻ ገጽዎ ነው። የዛሬ ቁልፍ ቁጥሮችን ያሳያል።",
        om: "Daashiboordiin foo'aa kee ti. Guyyaa kanaa lakkoofsa barbaachisaa agarsiisa.",
      },
      {
        en: "Cards at the top show: Available Rooms, Occupied Rooms, Today's Check-ins, Today's Check-outs.",
        am: "ከላይ ያሉ ካርዶች ያሳያሉ፦ የቀሩ ክፍሎች፣ የተያዡ ክፍሎች፣ የዛሬ ገብተዋል፣ የዛሬ ወጥተዋል።",
        om: "Kaartii gubbaa: Kutaalee kan kanaa, kan fayyadamaa, seenamsaa guyyaa kanaa, baamsaa guyyaa kanaa.",
      },
      {
        en: "Click any card to jump to the related page (e.g. click 'Available Rooms' to go to the Rooms page).",
        am: "በማንኛውም ካርድ ጠቅ ያድርጉ ወደ ተዛመደ ገጽ ለመውረድ።",
        om: "Kaartii kamiifuu cuqa'i oduu biraa fi.",
      },
      {
        en: "The Revenue chart at the bottom shows your last 7 days of income.",
        am: "ከታች ያለ የገቢ ግራፍ የመጨረሻ 7 ቀናት ገቢዎን ያሳያል።",
        om: "Gabaasa gadi jiruun galaa guyyaa 7 dabarse agarsiisa.",
      },
    ],
    tips: [
      {
        en: "The dashboard updates automatically every time you load it — no refresh needed.",
        am: "ዳሽቦርዱ በየጊዜው በራስ-ሰር ይሻሻላል።",
        om: "Daashiboordiin yeroo hunda ofiiayan fooyya'a.",
      },
    ],
  },

  {
    id: "add-room",
    page: "accommodation",
    title: {
      en: "How to Add a Room",
      am: "ክፍል እንዴት መጨመር ይቻላል",
      om: "Kutaa akkamitti dabaluu?",
    },
    keywords: ["room", "add", "create", "new", "ክፍል", "kuta", "kutaa"],
    steps: [
      {
        en: "Click 'Accommodation' → 'Rooms' in the left sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ማስተናገድ' → 'ክፍሎች' ጠቅ ያድርጉ።",
        om: "Cachii bitaa 'Accommodation' → 'Rooms' cuqa'i.",
      },
      {
        en: "Click the '+ Add Room' button at the top-right of the rooms list.",
        am: "ከክፍሎች ዝርዝር በላይ በቀኝ 'Add Room +' ቁልፍ ጠቅ ያድርጉ።",
        om: "Tarreeffama kutaalee ol gubbaa mirgaa '+ Add Room' cuqa'i.",
      },
      {
        en: "Fill in: Room Number (unique), Name, Type (Single/Double/Twin/Suite/etc), Price per Night (ETB), Floor, Capacity (max guests).",
        am: "ይሙሉ፦ የክፍል ቁጥር (ልዩ)፣ ስም፣ አይነት፣ የአንድ ሌሊት ዋጋ (ብር)፣ ፎቅ፣ አቅም።",
        om: "Guuta: Lakkoofsa kutaa, Maqaa, Akaakuu, Galma halkanii (ETB), Laafa, Humna.",
      },
      {
        en: "(Optional) Set Weekend Price — leave blank to use weekday rate for all nights.",
        am: "(አማራጭ) የሳምንት መጨረቻ ዋጋ ያዘጋጁ።",
        om: "(Filannoo) Galma fincaila sa'aa.",
      },
      {
        en: "Click 'Save' at the bottom of the form. The new room appears immediately.",
        am: "ከፎርሙ ታች 'አስቀምጥ' ጠቅ ያድርጉ።",
        om: "Foormii gadi 'Save' cuqa'i.",
      },
    ],
    tips: [
      {
        en: "Room numbers must be unique within your guesthouse.",
        am: "የክፍል ቁጥሮች በእናንተ የመኝብርያ ቤት ውስጥ ልዩ መሆን አለባቸው።",
        om: "Lakkoofsonni kutaa adda ta'uu qabu.",
      },
    ],
  },

  {
    id: "create-reservation",
    page: "accommodation",
    title: {
      en: "How to Create a Reservation",
      am: "ቀጣሪ እንዴት መፍጠር ይቻላል",
      om: "Kabajaa akkamitti uumuu?",
    },
    keywords: ["reservation", "booking", "create", "new", "ቀጣሪ", "ቦታ", "kabaja", "bookii"],
    steps: [
      {
        en: "Go to 'Accommodation' → 'Reservations' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ማስተናገድ' → 'ቀጣሪዎች' ይሂዱ።",
        om: "Cachii bitaa 'Accommodation' → 'Reservations' fi.",
      },
      {
        en: "Click '+ New Reservation' at the top-right.",
        am: "ከላይ በቀኝ '+ አዲስ ቀጣሪ' ጠቅ ያድርጉ።",
        om: "Gubbaa mirgaa '+ New Reservation' cuqa'i.",
      },
      {
        en: "Search for an existing guest by name, phone, or ID. If new, click 'Add New Guest' and fill details.",
        am: "ያለውን እንግድ በስም፣ በስልክ ወይም በመለያ ይፈልጉ። አዲስ ከሆነ 'አዲስ እንግድ ጨምር' ጠቅ ያድርጉ።",
        om: "Fayyadamaa jiru maqaa, bilbila, ykn ID'n barbaadi.",
      },
      {
        en: "Select the room. Available rooms are highlighted; occupied/maintenance rooms are dimmed.",
        am: "ክፍሉን ይምረጡ። የቀሩ ክፍሎች ይወጣሉ።",
        om: "Kutaa fili.",
      },
      {
        en: "Pick check-in and check-out dates. The system auto-calculates nights and total cost.",
        am: "የመግባት እና የመውጣት ቀናት ይምረጡ። ስርዓቱ በራስ-ሰር ይሰራል።",
        om: "Guyyaa seenaa fi baamsaa fili.",
      },
      {
        en: "Click 'Create Reservation'. Status is 'UPCOMING' until the guest checks in.",
        am: "'ቀጣሪ ፍጠር' ጠቅ ያድርጉ።",
        om: "'Create Reservation' cuqa'i.",
      },
    ],
    tips: [
      {
        en: "For DOUBLE rooms, you can add a second guest's name + phone + ID under 'Second Guest'.",
        am: "ለባለሁለት ክፍሎች፣ በ'ሁለተኛ እንግድ' ስር ሁለተኛ እንግድ መጨመር ይቻላል።",
        om: "Kutaa DOUBLE laaf, 'Second Guest' jala dabaluu danda'a.",
      },
    ],
  },

  {
    id: "check-in",
    page: "accommodation",
    title: {
      en: "How to Check In a Guest",
      am: "እንግድ እንዴት ማስገባት ይቻላል",
      om: "Fayyadamaa akkamitti seensisuu?",
    },
    keywords: ["check-in", "checkin", "arrival", "ግባ", "ማስገባት", "seensisa"],
    steps: [
      {
        en: "Go to 'Accommodation' → 'Reservations'. Find the reservation (status: UPCOMING).",
        am: "ወደ 'ማስተናገድ' → 'ቀጣሪዎች' ይሂዱ። ቀጣሪውን ይፈልጉ (ሁኔታ፦ ቀጣይ)።",
        om: "'Accommodation' → 'Reservations' fi.",
      },
      {
        en: "Click the 'Check In' button next to that reservation.",
        am: "በዚያ ቀጣሪ አጠገብ 'አስገባ' ቁልፍ ጠቅ ያድርጉ።",
        om: "'Check In' cuqa'i.",
      },
      {
        en: "The reservation status changes to ACTIVE. The room status changes to OCCUPIED automatically.",
        am: "የቀጣሪ ሁኔታ ወደ 'ንቁ' ይቀየራል።",
        om: "Haala kabajaa 'ACTIVE' tti akka ta'u jijjiira.",
      },
      {
        en: "Verify the guest's ID matches what's recorded.",
        am: "የእንግዱ መለያ ከመዝገበው ጋር ይዛመድ።",
        om: "ID fayyadamaa kan galmaa'e waliin walfakkaata.",
      },
    ],
    tips: [
      {
        en: "You can only check in UPCOMING reservations.",
        am: "የ'ቀጣይ' ቀጣሪዎችን ብቻ ማስገባት ይቻላል።",
        om: "Kabajaa 'UPCOMING' qofa seensisuu ni danda'a.",
      },
    ],
  },

  {
    id: "check-out",
    page: "accommodation",
    title: {
      en: "How to Check Out a Guest",
      am: "እንግድ እንዴት ማውጣት ይቻላል",
      om: "Fayyadamaa akkamitti baamsuu?",
    },
    keywords: ["check-out", "checkout", "departure", "አውጣ", "ማውጣት", "baamsa"],
    steps: [
      {
        en: "Go to 'Accommodation' → 'Reservations'. Find the reservation (status: ACTIVE).",
        am: "ወደ 'ማስተናገድ' → 'ቀጣሪዎች' ይሂዱ። ቀጣሪውን ይፈልጉ (ሁኔታ፦ ንቁ)።",
        om: "'Accommodation' → 'Reservations' fi.",
      },
      {
        en: "Click 'Check Out'. The system calculates any outstanding balance automatically.",
        am: "'አውጣ' ጠቅ ያድርጉ።",
        om: "'Check Out' cuqa'i.",
      },
      {
        en: "Record the final payment (Cash / Transfer / Card / Mobile). Reservation moves to COMPLETED.",
        am: "የመጨረሻ ክፍያን ይመዝግቡ። ቀጣሪው ወደ 'ተጠናቀቀ' ሁኔታ ይሄዳል።",
        om: "Kaffaltii dhumaa galmeessi.",
      },
      {
        en: "The room automatically becomes AVAILABLE again for new bookings.",
        am: "ክፍሉ ለአዲስ ቦታ ይያዙ በራስ-ሰር ወደ 'የቀረ' ይቀየራል።",
        om: "Kutaan ofiiayan 'AVAILABLE' tti deebi'a.",
      },
    ],
    tips: [],
  },

  {
    id: "add-guest",
    page: "accommodation",
    title: {
      en: "How to Add a Guest",
      am: "እንግድ እንዴት መጨመር ይቻላል",
      om: "Fayyadamaa akkamitti dabaluu?",
    },
    keywords: ["guest", "add", "create", "new", "እንግድ", "fayyadamaa"],
    steps: [
      {
        en: "Go to 'Accommodation' → 'Guests' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ማስተናገድ' → 'እንግዶች' ይሂዱ።",
        om: "Cachii bitaa 'Accommodation' → 'Guests' fi.",
      },
      {
        en: "Click '+ Add Guest' at the top-right.",
        am: "ከላይ በቀኝ '+ እንግድ ጨምር' ጠቅ ያድርጉ።",
        om: "Gubbaa mirgaa '+ Add Guest' cuqa'i.",
      },
      {
        en: "Fill: Full Name (required), Phone (required, format: +251XXXXXXXXX or 0XXXXXXXXX), Nationality, ID Type, ID Number, Address.",
        am: "ይሙሉ፦ ሙሉ ስም (አስፈላጊ)፣ ስልክ (አስፈላጊ)፣ ዜግነት፣ የመለያ አይነት፣ የመለያ ቁጥር፣ አድራሻ።",
        om: "Guuta: Maqaa guutuu, Bilbila, Lammumaa, Akaakuu ID, Lakkoofsa ID, Teessuma.",
      },
      {
        en: "Click 'Save'. The guest is now searchable for future reservations.",
        am: "'አስቀምጥ' ጠቅ ያድርጉ።",
        om: "'Save' cuqa'i.",
      },
    ],
    tips: [
      {
        en: "Guest phone numbers must be unique within your guesthouse.",
        am: "የእንግድ ስልክ ቁጥሮች ልዩ መሆን አለባቸው።",
        om: "Bilbilaa fayyadamaa adda ta'uu qaba.",
      },
    ],
  },

  {
    id: "add-expense",
    page: "expenses",
    title: {
      en: "How to Record an Expense",
      am: "ወጪ እንዴት መመዝገብ ይቻላል",
      om: "Kaffaltii akkamitti galmeessuu?",
    },
    keywords: ["expense", "add", "record", "cost", "ወጪ", "kaffaltii"],
    steps: [
      {
        en: "Go to 'Expenses' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ወጮች' ይሂዱ።",
        om: "Cachii bitaa 'Expenses' fi.",
      },
      {
        en: "Click '+ Add Expense' at the top-right.",
        am: "ከላይ በቀኝ '+ ወጪ ጨምር' ጠቅ ያድርጉ።",
        om: "Gubbaa mirgaa '+ Add Expense' cuqa'i.",
      },
      {
        en: "Select a Category (Salaries, Utilities, Maintenance, Supplies, Other).",
        am: "ምድብ ይምረጡ (ደመወዝ፣ የመገልገያዎች፣ ጥገና፣ እቃዎች፣ ሌላ)።",
        om: "Kaateegoora fili.",
      },
      {
        en: "Fill: Description, Amount (ETB), Payment Method, Vendor (optional), Receipt No. (optional).",
        am: "ይሙሉ፦ መግለፅ፣ መጠን (ብር)፣ የክፍያ ዘዴ፣ አቅራኝ (አማራጭ)፣ የራሲች ቁጥር (አማራጭ)።",
        om: "Guuta: Ibsa, Qabiyyee, Malaa kaffaltii, Maltu, Lakkoofsa rasitii.",
      },
      {
        en: "Click 'Save'. The expense is deducted from your daily cash reconciliation.",
        am: "'አስቀምጥ' ጠቅ ያድርጉ።",
        om: "'Save' cuqa'i.",
      },
    ],
    tips: [],
  },

  {
    id: "eod-report",
    page: "owner-eod",
    title: {
      en: "How to Submit End-of-Day Report",
      am: "የቀን መጨረሻ ሪፖርት እንዴት ማስጠበቅ ይቻላል",
      om: "Gabaasa dhuma guyyaa akkamitti dhiyeessuu?",
    },
    keywords: ["eod", "end of day", "report", "cash", "reconciliation", "የቀን መጨረሻ", "ሪፖርት"],
    steps: [
      {
        en: "Go to 'Operations' → 'End of Day Report' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ስራዎች' → 'የቀን መጨረሻ ሪፖርት' ይሂዱ።",
        om: "Cachii bitaa 'Operations' → 'End of Day Report' fi.",
      },
      {
        en: "The system auto-fills: opening cash, cash payments, telebirr/CBE/card totals, check-ins/outs.",
        am: "ስርዓቱ በራስ-ሰር ይሞላል፦ የመክፈቻ ጥሬ ገንቢ፣ የጥሬ ገንቢ ክፍያዎች፣ የቴቴ/ሲቢኢ/ካርድ ድምሮች።",
        om: "Sirrixi ofiiayan: caashaa bilookaa, kaffaltii caashaa, telebirr/CBE/card hunda.",
      },
      {
        en: "Count your actual cash drawer. Enter the 'Counted Cash' amount.",
        am: "ትክክለኛ የጥሬ ገንቢ ሰበቃ ይቁጠሩ።",
        om: "Dargagaa caashaa lakkoofi.",
      },
      {
        en: "Review the auto-calculated discrepancy. Explain any shortage in 'Notes'.",
        am: "በራስ-ሰር የተሰላ ልዩነት ይገመግሙ።",
        om: "Dhiphina ofiiayan herreegamuu ilaali.",
      },
      {
        en: "Click 'Sign Off'. The report is locked and sent to the guesthouse owner.",
        am: "'ፊርማ' ጠቅ ያድርጉ። ሪፖርቱ ተቆልፏል እና ለባለቤቱ ይላካል።",
        om: "'Sign Off' cuqa'i.",
      },
    ],
    tips: [
      {
        en: "EOD reports must be submitted before midnight. Late submissions are flagged to the owner.",
        am: "የቀን መጨረሻ ሪፖርቶች ከእኩለ ሌሊት በፊት መስጠት አለባቸው።",
        om: "Gabaasni dhuma guyyaa walakkaa halkanii oolchuu qaba.",
      },
    ],
  },

  {
    id: "shift-handover",
    page: "operations",
    title: {
      en: "How to Do a Shift Handover",
      am: "የፊርማ ለዋጭ እንዴት ማድረግ ይቻላል",
      om: "Wal-dhabbataa taphaa akkamitti godhu?",
    },
    keywords: ["shift", "handover", "ፊርማ", "ለዋጭ", "taphaa", "handover"],
    steps: [
      {
        en: "Go to 'Operations' → 'Shift Handover' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ስራዎች' → 'የፊርማ ለዋጭ' ይሂዱ።",
        om: "Cachii bitaa 'Operations' → 'Shift Handover' fi.",
      },
      {
        en: "Click 'Start Shift' at the beginning of your shift. Enter the opening cash amount.",
        am: "በፊርማዎ መጀመሪያ 'የፊርማ ጀምር' ጠቅ ያድርጉ።",
        om: "'Start Shift' cuqa'i.",
      },
      {
        en: "During your shift, all cash transactions are tracked automatically.",
        am: "በፊርማዎ ወቅት ሁሉም የጥሬ ገንቢ ግብይቶች በራስ-ሰር ይከታተላሉ።",
        om: "Taphaa kee yeroo, kaffaltii caashaa hundi ofiiayan to'atama.",
      },
      {
        en: "At end of shift, click 'End Shift'. Count cash, enter closing amount, write handover notes.",
        am: "በፊርማ መጨረሻ 'ፊርማ አቁም' ጠቅ ያድርጉ።",
        om: "Dhuma taphaa 'End Shift' cuqa'i.",
      },
      {
        en: "Click 'Sign Off'. The next operator can now start their shift.",
        am: "'ፊርማ' ጠቅ ያድርጉ።",
        om: "'Sign Off' cuqa'i.",
      },
    ],
    tips: [],
  },

  {
    id: "send-message",
    page: "guest-communication",
    title: {
      en: "How to Send a Message to a Guest",
      am: "ለእንግድ መልዕክት እንዴት መላክ ይቻላል",
      om: "Ergaa fayyadamaatti akkamitti erguu?",
    },
    keywords: ["message", "send", "sms", "whatsapp", "template", "መልዕክት", "መላክ", "ergaa"],
    steps: [
      {
        en: "Go to 'Messages' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'መልዕክቶች' ይሂዱ።",
        om: "Cachii bitaa 'Messages' fi.",
      },
      {
        en: "Click '+ New Message' at the top-right.",
        am: "ከላይ በቀኝ '+ አዲስ መልዕክት' ጠቅ ያድርጉ።",
        om: "Gubbaa mirgaa '+ New Message' cuqa'i.",
      },
      {
        en: "Select recipients: by reservation, by room, or broadcast to all current guests.",
        am: "ተቀባዮችን ይምረጡ፦ በቀጣሪ፣ በክፍል፣ ወይም ለሁሉም የአሁኑ እንግዶች።",
        om: "Fudhataa fili.",
      },
      {
        en: "Choose a template or write a custom message.",
        am: "ዲዛይን ይምረጡ ወይም የራስዎን መልዕክት ይጻፉ።",
        om: "Template fili ykn ergaa ati ofii barreessi.",
      },
      {
        en: "Click 'Send'. Messages are sent via the configured channel (Telegram/WhatsApp/SMS).",
        am: "'ላክ' ጠቅ ያድርጉ።",
        om: "'Send' cuqa'i.",
      },
    ],
    tips: [
      {
        en: "Message logs are saved with status (Sent/Delivered/Failed). Failed messages can be retried.",
        am: "የመልዕክት ምዝገባዎች በሁኔታ ይቀመጣሉ። የወደቀ መልዕክቶችን እንደገና ልክ ማድረግ ይቻላል።",
        om: "Logiin ergaa haala waliin olkaa'ama.",
      },
    ],
  },

  {
    id: "housekeeping",
    page: "housekeeping",
    title: {
      en: "How to Manage Housekeeping Tasks",
      am: "የቤት ጥገና ስራዎችን እንዴት ማስተዳደር ይቻላል",
      om: "Hojii qopheessituu mana akkamitti bulchu?",
    },
    keywords: ["housekeeping", "cleaning", "maintenance", "ጥገና", "ንጹህ", "qopheessituu"],
    steps: [
      {
        en: "Go to 'Housekeeping' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'የቤት ጥገና' ይሂዱ።",
        om: "Cachii bitaa 'Housekeeping' fi.",
      },
      {
        en: "Click '+ New Task'. Select room, task type (Cleaning/Maintenance/Inspection), assign to staff.",
        am: "'+ አዲስ ስራ' ጠቅ ያድርጉ። ክፍል፣ የስራ አይነት፣ ለሰራተኛ ያዋዳዱ።",
        om: "'+ New Task' cuqa'i.",
      },
      {
        en: "Set the scheduled date. The task appears in the assigned staff's queue.",
        am: "የታቀደውን ቀን ያዘጋጁ።",
        om: "Guyyaa qophooyee galchi.",
      },
      {
        en: "When the staff member completes the task, they click 'Mark as Completed'.",
        am: "ሰራተኛው ስራውን ሲያጠናቅቅ 'እንደ ተጠናቀቀ ምልክት ያድርግ' ጠቅ ያድርጉ።",
        om: "'Mark as Completed' cuqa'i.",
      },
      {
        en: "Completed tasks move to history. The room status auto-updates.",
        am: "የተጠናቀቁ ስራዎች ወደ ታሪክ ይሄዳሉ።",
        om: "Hojii dhume taate seenaa tti gale.",
      },
    ],
    tips: [],
  },

  {
    id: "group-booking",
    page: "accommodation",
    title: {
      en: "How to Create a Group Booking",
      am: "የቡድን ቦታ እንዴት መፍጠር ይቻላል",
      om: "Kabajaa garee akkamitti uumuu?",
    },
    keywords: ["group", "booking", "team", "tour", "ቡድን", "ቦታ", "garee"],
    steps: [
      {
        en: "Go to 'Accommodation' → 'Group Bookings' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ማስተናገድ' → 'የቡድን ቦታዎች' ይሂዱ።",
        om: "Cachii bitaa 'Accommodation' → 'Group Bookings' fi.",
      },
      {
        en: "Click '+ New Group Booking'. Fill: Group Name, Contact Person, Phone, Start/End Date, Total Guests.",
        am: "'+ አዲስ የቡድን ቦታ' ጠቅ ያድርጉ።",
        om: "'+ New Group Booking' cuqa'i.",
      },
      {
        en: "Set the discount: choose Type (Amount or Percent), enter the discount value.",
        am: "ቅነሳውን ያዘጋጁ።",
        om: "Gadi-aanuu galchi.",
      },
      {
        en: "Click 'Create Group Booking'. Status is 'PENDING'.",
        am: "'የቡድን ቦታ ፍጠር' ጠቅ ያድርጉ።",
        om: "'Create Group Booking' cuqa'i.",
      },
      {
        en: "Open the group to assign individual rooms to each guest in the group.",
        am: "ቡድኑን ይክፈቱ ለእያንዳንዱ እንግድ የራሱን ክፍል ለመመደብ።",
        om: "Garicha baniif fayyadamaa tokkoon tokkoo kutaa assisi.",
      },
    ],
    tips: [],
  },

  {
    id: "settings",
    page: "settings",
    title: {
      en: "How to Configure Guesthouse Settings",
      am: "የመኝብርያ ቤት ቅንብሮችን እንዴት ማዋቀድ ይቻላል",
      om: "Qindaa'a lafaa akkamitti qindeessuu?",
    },
    keywords: ["settings", "config", "guesthouse", "configure", "ቅንብሮች", "ማዋቀድ", "qindaa'a"],
    steps: [
      {
        en: "Go to 'Settings' in the sidebar.",
        am: "በግራ የጎን አሞሌ ላይ 'ቅንብሮች' ይሂዱ።",
        om: "Cachii bitaa 'Settings' fi.",
      },
      {
        en: "Update: Guesthouse Name, Owner Name, Address, Phone, Email, Currency, Tax Rate, Language.",
        am: "ያዘመኑ፦ የመኝብርያ ቤት ስም፣ የባለቤት ስም፣ አድራሻ፣ ስልክ፣ ኢሜይል፣ ገንቢ፣ የግብር መጠን፣ ቋንቋ።",
        om: "Haara'i: Maqaa qophiyyee, Maqaa abbaa lafaa, Teessuma, Bilbila, Imeelii, Maallaqa, Himma beltaa, Afaan.",
      },
      {
        en: "Set Default Check-in Time (default 14:00) and Check-out Time (default 12:00).",
        am: "የነባር የመግባት ሰዓት (14:00) እና የመውጣት ሰዓት (12:00) ያዘጋጁ።",
        om: "Sa'aatii seenamsaa fi baamsaa qindeessi.",
      },
      {
        en: "Upload a logo (used on printed receipts and reports).",
        am: "አርማ ይስቀሉ።",
        om: "Looḍoo fe'i.",
      },
      {
        en: "Click 'Save'. Changes take effect immediately across the operator module.",
        am: "'አስቀምጥ' ጠቅ ያድርጉ።",
        om: "'Save' cuqa'i.",
      },
    ],
    tips: [],
  },

  {
    id: "notifications",
    page: "notifications",
    title: {
      en: "How to View Notifications",
      am: "ማሳወቂያዎችን እንዴት ማየት ይቻላል",
      om: "Beeksisaa akkamitti arguu?",
    },
    keywords: ["notification", "alert", "ማሳወቂያ", "beeksisa", "alert"],
    steps: [
      {
        en: "The bell icon in the top-right shows unread notification count.",
        am: "ከላይ በቀኝ ያለ የጥቅል ምልክት ያልተነበቡ ማሳወቂያዎችን ቁጥር ያሳያል።",
        om: "Ciiqaa gubbaa mirgaa lakkoofsa beeksisa kan hin qabamne agarsiisa.",
      },
      {
        en: "Click the bell to open the notification panel. Filter by: All / Unread / Suspect Alerts / System.",
        am: "የማሳወቂያ ፓናል ለመክፈት ይጥቀሙ።",
        om: "Paaneel beeksaa banuuf ciiqaa cuqa'i.",
      },
      {
        en: "Click a notification to view details and mark as read.",
        am: "ዝርዝሮችን ለማየት እና እንደ ተነበበ ለምልክት ማሳወቂያ ጠቅ ያድርጉ።",
        om: "Detaili ilaachuuf cuqa'i.",
      },
      {
        en: "Suspect Alerts come from the police module. Take action immediately.",
        am: "የሱስፔክት ማስታወቂያዎች ከፖሊስ ሞጁል ይመጣሉ። ወዲያውኑ ድርጊት ያድርጉ።",
        om: "Beeksisni Suspect police module irraa dhufa.",
      },
    ],
    tips: [],
  },
];

/**
 * Search help articles by keyword. Returns matches sorted by relevance.
 */
export function searchHelpArticles(query: string): HelpArticle[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  return helpArticles
    .map((article) => {
      let score = 0;
      for (const token of tokens) {
        for (const keyword of article.keywords) {
          if (keyword.toLowerCase().includes(token)) {
            score += 1;
            break;
          }
        }
        if (
          article.title.en.toLowerCase().includes(token) ||
          article.title.am.includes(token) ||
          article.title.om.includes(token)
        ) {
          score += 1;
        }
      }
      return { article, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.article);
}

/**
 * Get the help article for a specific page (sidebar page key).
 */
export function getHelpForPage(page: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.page === page);
}
