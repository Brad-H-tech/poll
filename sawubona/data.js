// Sawubona — shared data + brief-building logic.
// Loaded by both the app page (index.html) and the service worker (sw.js),
// so it must be plain script: no imports, no DOM access, no window-only APIs.

// ---------------------------------------------------------------------------
// Zulu word of the day (rotates daily; c = dental click "tut", q = palatal
// click "cork pop", x = lateral click "gee-up a horse")
// ---------------------------------------------------------------------------
const ZULU_WORDS = [
  { w: "Sawubona", say: "sah-woo-BOH-nah", m: "Hello (to one person) — literally \"I see you\"", eg: "Sawubona, unjani? — Hello, how are you?" },
  { w: "Yebo", say: "YEH-boh", m: "Yes (also used as a casual greeting reply)", eg: "Yebo, ngiyavuma. — Yes, I agree." },
  { w: "Ngiyabonga", say: "ngee-yah-BON-gah", m: "Thank you", eg: "Ngiyabonga kakhulu! — Thank you very much!" },
  { w: "Unjani?", say: "oon-JAH-nee", m: "How are you? (to one person)", eg: "Sawubona! Unjani namhlanje? — Hello! How are you today?" },
  { w: "Ngiyaphila", say: "ngee-yah-PEE-lah", m: "I am well / I'm fine", eg: "Ngiyaphila, ngiyabonga. — I'm well, thank you." },
  { w: "Hamba kahle", say: "HAHM-bah GAH-shle", m: "Go well — said to the person who is leaving", eg: "Hamba kahle, mngane wami! — Go well, my friend!" },
  { w: "Sala kahle", say: "SAH-lah GAH-shle", m: "Stay well — said when you are the one leaving", eg: "Sala kahle, sizobonana kusasa. — Stay well, see you tomorrow." },
  { w: "Ubuntu", say: "oo-BOON-too", m: "Humanity, kindness — \"I am because we are\"", eg: "Umuntu ngumuntu ngabantu. — A person is a person through other people." },
  { w: "Amanzi", say: "ah-MAHN-zee", m: "Water", eg: "Ngicela amanzi. — May I have some water, please." },
  { w: "Ukudla", say: "oo-GOO-dlah", m: "Food", eg: "Ukudla kumnandi! — The food is delicious!" },
  { w: "Umakhalekhukhwini", say: "oo-mah-kah-leh-koo-KWEE-nee", m: "Cellphone — literally \"the thing that cries in the pocket\"", eg: "Ungawukhohlwa umakhalekhukhwini wakho. — Don't forget your cellphone." },
  { w: "Umngane", say: "oom-NGAH-neh", m: "Friend", eg: "Ungumngane wami omkhulu. — You are my great friend." },
  { w: "Uthando", say: "oo-TAHN-doh", m: "Love", eg: "Uthando lunqoba konke. — Love conquers all." },
  { w: "Imali", say: "ee-MAH-lee", m: "Money", eg: "Imali ayitheli emithini. — Money doesn't grow on trees." },
  { w: "Umsebenzi", say: "oom-seh-BEN-zee", m: "Work, a job", eg: "Nginomsebenzi omusha. — I have a new job." },
  { w: "Ikhaya", say: "ee-KAH-yah", m: "Home", eg: "Ngiya ekhaya. — I am going home." },
  { w: "Indlu", say: "een-DLOO", m: "House", eg: "Indlu enhle! — What a beautiful house!" },
  { w: "Ilanga", say: "ee-LAHN-gah", m: "Sun (also means \"day\")", eg: "Ilanga liyashisa namhlanje. — The sun is hot today." },
  { w: "Inyanga", say: "een-YAHN-gah", m: "Moon (also means \"month\")", eg: "Inyanga iyakhanya ebusuku. — The moon shines at night." },
  { w: "Inkanyezi", say: "een-kah-NYEH-zee", m: "Star", eg: "Bheka izinkanyezi! — Look at the stars!" },
  { w: "Imvula", say: "eem-VOO-lah", m: "Rain", eg: "Imvula iyana. — It is raining." },
  { w: "Umoya", say: "oo-MOH-yah", m: "Wind, air — also spirit", eg: "Umoya uyavunguza. — The wind is blowing." },
  { w: "Umlilo", say: "oom-LEE-loh", m: "Fire", eg: "Basa umlilo. — Light the fire." },
  { w: "Intaba", say: "een-TAH-bah", m: "Mountain", eg: "Intaba ende kakhulu. — A very tall mountain." },
  { w: "Ulwandle", say: "ool-WAHN-dleh", m: "The sea, ocean", eg: "Siya olwandle ngeSonto. — We're going to the sea on Sunday." },
  { w: "Umfula", say: "oom-FOO-lah", m: "River", eg: "Umfula ugcwele amanzi. — The river is full of water." },
  { w: "Isihlahla", say: "ee-see-SHLAH-shlah", m: "Tree", eg: "Isihlahla esikhulu. — A big tree." },
  { w: "Imbali", say: "eem-BAH-lee", m: "Flower", eg: "Imbali enhle. — A pretty flower." },
  { w: "Inja", say: "EEN-jah", m: "Dog", eg: "Inja yami ithanda ukudlala. — My dog loves to play." },
  { w: "Ikati", say: "ee-KAH-tee", m: "Cat", eg: "Ikati lilele elangeni. — The cat is sleeping in the sun." },
  { w: "Inkomo", say: "een-KOH-moh", m: "Cow", eg: "Izinkomo zidla utshani. — The cows are eating grass." },
  { w: "Ihhashi", say: "ee-HAH-shee", m: "Horse", eg: "Ihhashi eliphuma phambili. — The horse that runs in front (the winner)." },
  { w: "Inyoni", say: "een-YOH-nee", m: "Bird", eg: "Inyoni iyacula. — The bird is singing." },
  { w: "Imbuzi", say: "eem-BOO-zee", m: "Goat", eg: "Imbuzi idla yonke into. — A goat eats everything." },
  { w: "Umama", say: "oo-MAH-mah", m: "Mother, mom", eg: "Umama uyapheka. — Mom is cooking." },
  { w: "Ubaba", say: "oo-BAH-bah", m: "Father, dad", eg: "Ubaba usemsebenzini. — Dad is at work." },
  { w: "Ugogo", say: "oo-GOH-goh", m: "Grandmother", eg: "Ugogo uxoxa izindaba. — Granny tells stories." },
  { w: "Umkhulu", say: "oom-KOO-loo", m: "Grandfather", eg: "Umkhulu uhlakaniphile. — Grandfather is wise." },
  { w: "Ingane", say: "een-GAH-neh", m: "Child", eg: "Ingane iyahleka. — The child is laughing." },
  { w: "Isinkwa", say: "ee-SEEN-kwah", m: "Bread", eg: "Ngicela isinkwa nebhotela. — Bread and butter, please." },
  { w: "Ubisi", say: "oo-BEE-see", m: "Milk", eg: "Itiye nobisi. — Tea with milk." },
  { w: "Itiye", say: "ee-TEE-yeh", m: "Tea", eg: "Ngicela itiye. — Tea, please." },
  { w: "Ikhofi", say: "ee-KOH-fee", m: "Coffee", eg: "Ikhofi ekuseni! — Coffee in the morning!" },
  { w: "Inyama", say: "een-YAH-mah", m: "Meat", eg: "Inyama eyosiwe — braaied meat. Yum." },
  { w: "Namhlanje", say: "nahm-SHLAHN-jeh", m: "Today", eg: "Namhlanje usuku oluhle. — Today is a beautiful day." },
  { w: "Kusasa", say: "goo-SAH-sah", m: "Tomorrow", eg: "Sizobonana kusasa. — We'll see each other tomorrow." },
  { w: "Izolo", say: "ee-ZOH-loh", m: "Yesterday", eg: "Ngambona izolo. — I saw him/her yesterday." },
  { w: "Manje", say: "MAHN-jeh", m: "Now", eg: "Woza manje! — Come now!" },
  { w: "Ekuseni", say: "eh-goo-SEH-nee", m: "In the morning", eg: "Ngivuka ekuseni. — I wake up in the morning." },
  { w: "Ntambama", say: "n-tahm-BAH-mah", m: "In the afternoon", eg: "Sizodlala ntambama. — We'll play in the afternoon." },
  { w: "Ebusuku", say: "eh-boo-SOO-goo", m: "At night", eg: "Izinkanyezi zivela ebusuku. — The stars come out at night." },
  { w: "Isikhathi", say: "ee-see-KAH-tee", m: "Time", eg: "Isikhathi yimali. — Time is money." },
  { w: "Usuku", say: "oo-SOO-goo", m: "Day", eg: "Usuku oluhle! — Have a nice day!" },
  { w: "Iviki", say: "ee-VEE-kee", m: "Week", eg: "Iviki elizayo — next week." },
  { w: "Unyaka", say: "oon-YAH-gah", m: "Year", eg: "Unyaka omusha omuhle! — Happy new year!" },
  { w: "Phuza", say: "POO-zah", m: "Drink (verb)", eg: "Phuza amanzi amaningi. — Drink lots of water." },
  { w: "Dlala", say: "DLAH-lah", m: "Play (verb)", eg: "Izingane ziyadlala. — The children are playing." },
  { w: "Funda", say: "FOON-dah", m: "Learn / read (verb)", eg: "Ngifunda isiZulu! — I am learning Zulu!" },
  { w: "Bhala", say: "BAH-lah", m: "Write (verb)", eg: "Bhala igama lakho. — Write your name." },
  { w: "Cula", say: "(click)OO-lah — the c is a soft \"tut\" click", m: "Sing (verb)", eg: "Siyathanda ukucula. — We love to sing." },
  { w: "Gijima", say: "gee-JEE-mah", m: "Run (verb)", eg: "Gijima ngokushesha! — Run fast!" },
  { w: "Hamba", say: "HAHM-bah", m: "Go, walk (verb)", eg: "Asihambe! — Let's go!" },
  { w: "Lala", say: "LAH-lah", m: "Sleep (verb)", eg: "Lala kahle. — Sleep well." },
  { w: "Vuka", say: "VOO-gah", m: "Wake up (verb)", eg: "Vuka! Sekusile! — Wake up! It's morning!" },
  { w: "Sebenza", say: "seh-BEN-zah", m: "Work (verb)", eg: "Ngisebenza kanzima. — I work hard." },
  { w: "Thenga", say: "TEN-gah", m: "Buy (verb)", eg: "Ngithenga isinkwa. — I am buying bread." },
  { w: "Buka", say: "BOO-gah", m: "Look, watch (verb)", eg: "Buka lokhu! — Look at this!" },
  { w: "Lalela", say: "lah-LEH-lah", m: "Listen (verb)", eg: "Lalela kahle. — Listen carefully." },
  { w: "Khuluma", say: "koo-LOO-mah", m: "Speak, talk (verb)", eg: "Ukhuluma isiZulu? — Do you speak Zulu?" },
  { w: "Siza", say: "SEE-zah", m: "Help (verb)", eg: "Ngicela ungisize. — Please help me." },
  { w: "Woza", say: "WOH-zah", m: "Come! (command)", eg: "Woza lapha! — Come here!" },
  { w: "Shesha", say: "SHEH-shah", m: "Hurry, be quick", eg: "Shesha, sizosala! — Hurry, we'll be left behind!" },
  { w: "Kahle", say: "GAH-shle", m: "Well, nicely — also \"slow down / easy!\"", eg: "Kwenze kahle. — Do it nicely." },
  { w: "Kakhulu", say: "gah-KOO-loo", m: "A lot, very much", eg: "Ngiyabonga kakhulu. — Thank you very much." },
  { w: "Kancane", say: "gahn-(click)AH-neh — the c is a soft \"tut\" click", m: "A little, slowly", eg: "Ngikhuluma isiZulu kancane. — I speak a little Zulu." },
  { w: "Igama", say: "ee-GAH-mah", m: "Name (also means \"word\" or \"song\")", eg: "Igama lami ngu-Brad. — My name is Brad." },
  { w: "Isibongo", say: "ee-see-BON-goh", m: "Surname / clan name — very important in Zulu culture", eg: "Ngubani isibongo sakho? — What is your surname?" },
  { w: "Umculo", say: "oom-(click)OO-loh — the c is a soft \"tut\" click", m: "Music", eg: "Ngithanda umculo. — I love music." },
  { w: "Impilo", say: "eem-PEE-loh", m: "Life, health", eg: "Impilo enhle! — Cheers! / To a good life!" },
  { w: "Ibhola", say: "ee-BOH-lah", m: "Ball — or football/soccer", eg: "Sibuka ibhola. — We are watching soccer." },
  { w: "Uxolo", say: "oo-(click)OH-loh — the x is a side-of-the-mouth click", m: "Sorry / excuse me (also means \"peace\")", eg: "Uxolo, ngiphuzile. — Sorry, I'm late." },
  { w: "Sanibonani", say: "sah-nee-boh-NAH-nee", m: "Hello (to more than one person)", eg: "Sanibonani nonke! — Hello everyone!" },
  { w: "Hhayibo!", say: "HAH-yee-boh", m: "\"No way!\" — surprise or disbelief", eg: "Hhayibo! Ngeke ngikholwe! — No way! I can't believe it!" },
];

// ---------------------------------------------------------------------------
// Did-you-know: tech & Claude facts in plain English (rotates daily)
// ---------------------------------------------------------------------------
const TECH_FACTS = [
  { t: "What is Claude?", f: "Claude is an AI assistant made by a company called Anthropic. You chat with it in normal language and it can answer questions, write documents, and even build whole apps — including this one, which was built entirely by Claude." },
  { t: "What is Supabase?", f: "Supabase is a free online database service. Think of it as a giant shared spreadsheet living on the internet that your apps can save things into and read back from — it's what apps use to remember data between visits and share it between people." },
  { t: "What is a pull request?", f: "A pull request (or \"PR\") is how programmers propose changes to code. Instead of changing the real thing directly, you submit your changes for review — like handing in a draft — and someone approves and merges them in. It's called that because you're asking the owner to \"pull\" your changes into their project." },
  { t: "What is GitHub?", f: "GitHub is a website where people store code projects. It keeps every version ever saved, so nothing is ever truly lost, and it lets many people work on the same project without stepping on each other. This very app lives on GitHub!" },
  { t: "What is Git?", f: "Git is the save-system underneath GitHub. Every time you \"commit\", Git takes a snapshot of your whole project. You can rewind to any snapshot ever taken — it's like unlimited undo for an entire project, going back years." },
  { t: "What is a commit?", f: "A commit is one saved snapshot of a project, with a short note explaining what changed — like \"Fixed the login button\". A project's history is just a long chain of commits, and you can travel back to any of them." },
  { t: "What is a repository?", f: "A repository (or \"repo\") is one project's folder on GitHub — all its files, plus its entire history of changes. Public repos can be seen by anyone; private ones only by people you invite." },
  { t: "What is a branch?", f: "A branch is a parallel copy of a project where you can experiment safely. The main version stays untouched while you work on your branch, and when you're happy, you merge your branch back in. Like practising on a photocopy before writing on the original." },
  { t: "What is 'merging'?", f: "Merging is combining two versions of a project into one. If two people changed different things, it happens automatically. If they changed the same line, that's a \"merge conflict\" and a human has to pick which version wins." },
  { t: "What is an API?", f: "An API is a way for two programs to talk to each other. When a weather app shows you the forecast, it's asking a weather company's API. Think of it as a restaurant menu: it lists exactly what you can ask for and how to ask." },
  { t: "What is an API key?", f: "An API key is like a password for programs. When your app asks another service for something (weather, AI answers, payments), the key proves it's really your app asking — and it's how the service knows whose account to bill. Never share yours!" },
  { t: "What is a PWA?", f: "A PWA (Progressive Web App) is a website that behaves like a real app: you can add it to your home screen, it gets its own icon, opens full-screen without the browser bar, and can even work offline. This app is a PWA — no app store needed." },
  { t: "What is a service worker?", f: "A service worker is a small invisible helper program that a website installs on your phone. It keeps working even when the page is closed — it's what lets web apps load offline and show notifications." },
  { t: "What is 'the cloud'?", f: "\"The cloud\" just means someone else's computers. When your photos are \"in the cloud\", they're on huge computer warehouses (data centres) owned by companies like Google, Amazon or Microsoft, which you reach over the internet." },
  { t: "What is a server?", f: "A server is a computer whose whole job is to answer requests from other computers. When you open a website, your phone asks a server \"please send me that page\", and the server sends it. It's called a server because it serves." },
  { t: "What is a database?", f: "A database is a program built for storing and finding information fast — names, orders, messages, scores. Like a filing cabinet with a superhumanly fast librarian: \"find every customer in Durban who ordered last month\" comes back in milliseconds." },
  { t: "What is SQL?", f: "SQL (often said \"sequel\") is the language used to ask databases questions. It reads almost like English: SELECT name FROM customers WHERE city = 'Durban'. It's been the standard way to talk to databases for nearly 50 years." },
  { t: "What is HTML?", f: "HTML is the language web pages are written in. It describes what's on the page — this is a heading, this is a paragraph, this is a button. Right-click any webpage, choose \"View source\", and you're looking at HTML." },
  { t: "What is CSS?", f: "If HTML says what is on a page, CSS says how it looks — colours, sizes, spacing, animations. The yellow theme of this app? That's CSS. Same page, different CSS, completely different look." },
  { t: "What is JavaScript?", f: "JavaScript is the language that makes web pages do things — react when you tap, fetch new data, update the screen. HTML is the skeleton, CSS is the outfit, JavaScript is the muscles." },
  { t: "Frontend vs backend?", f: "The frontend is everything you see and touch — buttons, screens, colours. The backend is the machinery behind the scenes — servers, databases, logic. A restaurant analogy: frontend is the dining room, backend is the kitchen." },
  { t: "What is an LLM?", f: "LLM stands for Large Language Model — the technology behind Claude and ChatGPT. It's a program trained on enormous amounts of text until it learned the patterns of language well enough to understand questions and write useful answers." },
  { t: "What are tokens?", f: "AI models like Claude read and write text in small chunks called tokens — roughly ¾ of a word each. AI pricing is usually per million tokens, which is why long conversations cost more than short ones." },
  { t: "What is a prompt?", f: "A prompt is whatever you type to an AI — your question or instruction. Writing better prompts gets dramatically better answers: give context, be specific, and say what format you want. \"Write a polite 3-sentence email declining the meeting\" beats \"write email\"." },
  { t: "What is a system prompt?", f: "A system prompt is a hidden instruction given to an AI before your conversation starts — like \"You are a helpful assistant for a bank; never give legal advice.\" It sets the AI's personality and rules without you ever seeing it." },
  { t: "What is AI 'hallucination'?", f: "When an AI confidently states something that's simply wrong — a fake fact, a made-up quote — that's called a hallucination. It happens because AIs predict plausible-sounding text rather than looking things up. Always double-check important facts!" },
  { t: "What is a context window?", f: "An AI's context window is its short-term memory — how much of the conversation it can \"see\" at once. Claude's can hold roughly a whole shelf of books. Anything that scrolls out of the window is forgotten unless it gets summarised." },
  { t: "What is an AI agent?", f: "A regular chatbot just answers. An AI agent takes actions: it can search the web, run programs, edit files, and work through multi-step tasks on its own — checking its own work as it goes. This app was built by an agent (Claude) that wrote, tested and published the code itself." },
  { t: "What is Claude Code?", f: "Claude Code is a version of Claude that works directly with code and computers. You describe what you want in plain English — \"build me an app that...\" — and it writes the files, fixes its own errors, and publishes the result. It's how this app was made." },
  { t: "What is MCP?", f: "MCP (Model Context Protocol) is like a universal plug standard for AI. It lets Claude connect to outside things — your calendar, GitHub, a database — through one common connector, instead of needing a custom cable for each." },
  { t: "What are Claude Artifacts?", f: "Artifacts are Claude's way of building something you can actually use — a working web page, a document, a diagram — in a panel next to the chat, instead of just describing it in words. You can watch it update live as you ask for changes." },
  { t: "What is JSON?", f: "JSON is the standard format programs use to pass data around, and it's actually readable: {\"name\": \"Brad\", \"city\": \"Durban\"}. When apps talk to servers, they're usually swapping JSON back and forth." },
  { t: "What is hosting?", f: "Hosting means putting your website's files on a server so the world can reach them. This app is hosted free on GitHub Pages — GitHub simply serves the files to anyone who visits the address. No monthly fees, no server to manage." },
  { t: "What is a domain name?", f: "A domain name is a website's human-friendly address, like mtn.co.za. Computers actually find each other by numbers (IP addresses); domains exist so people don't have to remember 102.132.96.5. You rent them yearly, usually for a few hundred rand." },
  { t: "What is DNS?", f: "DNS is the internet's phone book. When you type mtn.co.za, DNS looks up which numeric address that name points to, so your phone knows which server to call. Nearly every internet action starts with a DNS lookup." },
  { t: "What is HTTPS?", f: "The padlock in your browser means HTTPS: everything between you and the website is encrypted, so nobody in between — not the coffee-shop Wi-Fi, not your ISP — can read your passwords or card numbers in transit. Never type a password on a site without it." },
  { t: "What is a cookie?", f: "A cookie is a tiny note a website leaves in your browser so it recognises you next time — that's how sites keep you logged in. The annoying part: advertising cookies can follow you between sites, which is why every site now asks permission." },
  { t: "What is a cache?", f: "A cache is a nearby copy of something kept to avoid fetching it again — your browser saves images so pages load faster next visit. It's why \"clear your cache\" fixes weird website problems: you throw away possibly-stale copies and fetch fresh ones." },
  { t: "What is a bug?", f: "A bug is a mistake in a program. The name is real history: in 1947 engineers found an actual moth stuck inside a computer causing errors, taped it into the logbook, and wrote \"first actual case of bug being found\"." },
  { t: "What is debugging?", f: "Debugging is detective work on code: something's wrong, and you narrow down where. The classic technique is embarrassingly effective — explain the problem out loud, even to a rubber duck on your desk. Half the time you spot the answer mid-sentence." },
  { t: "What is open source?", f: "Open-source software publishes its recipe — anyone can read the code, check it, improve it, use it free. Huge parts of the internet run on it: Linux, Firefox, WordPress. Thousands of strangers collaborating on GitHub keep it alive." },
  { t: "What is localhost?", f: "\"localhost\" means \"this computer right here\". Developers run websites on localhost while building them — a private version only they can see — then publish to a real server when ready. If you ever see localhost in an address bar, you're looking at someone's work-in-progress." },
  { t: "What's in a web address?", f: "Take https://news.mtn.com/za/deals?ref=sms — https is the secure protocol, news.mtn.com is the server, /za/deals is the page on it, and ?ref=sms is extra info tagging where you came from. Every link breaks down this way." },
  { t: "What is RSS?", f: "RSS is an old but brilliant standard where websites publish their latest headlines in a machine-readable list. News apps (including this one!) read those lists to gather stories from many sites — no scrolling through each one." },
  { t: "What is a push notification?", f: "A push notification is a message a service sends to your phone — the phone keeps one quiet connection open to Google or Apple, and everything (WhatsApp, news, banking alerts) arrives through that shared pipe. That trick is what keeps it from destroying your battery." },
  { t: "What is a QR code?", f: "A QR code is just text — usually a web address — drawn as squares a camera can read. The three big corner squares tell the camera which way is up. Invented in 1994 for tracking car parts in Japanese factories; \"QR\" means Quick Response." },
  { t: "Wi-Fi vs mobile data?", f: "Both are wireless internet. Wi-Fi comes from a nearby router (usually connected to a fibre line) and is typically cheap or free. Mobile data comes from cell towers — MTN's business! — and works almost everywhere, but you pay per gigabyte." },
  { t: "What is a VPN?", f: "A VPN wraps your internet traffic in an encrypted tunnel to another computer, which then goes to websites on your behalf. Sites see the VPN's location, not yours, and your network can't see what you're doing — useful for privacy and for work systems." },
  { t: "What is 2FA?", f: "Two-factor authentication means a password alone isn't enough — you also need a code from your phone. Even if someone steals your password, they can't get in. Turn it on for email and banking first; email especially, since it can reset everything else." },
  { t: "What is phishing?", f: "Phishing is fake messages dressed up as real ones — \"Your package is held, click here\", \"Your account will be closed\". The link leads to a lookalike site that steals what you type. Golden rule: never log in from a link in a message; go to the site yourself." },
  { t: "What is encryption?", f: "Encryption scrambles information so only someone with the right key can unscramble it. \"End-to-end encrypted\" (like WhatsApp) means only your phone and the recipient's phone hold keys — not even the company in the middle can read the messages." },
  { t: "What is machine learning?", f: "Instead of programmers writing rules (\"spam contains the word 'winner'\"), machine learning shows a computer millions of examples and lets it work out the rules itself. That's how phones recognise faces and how Claude learned language." },
  { t: "What is a GPU?", f: "A GPU is a chip originally built to draw video-game graphics — thousands of tiny calculators working at once. It turned out that's exactly what AI needs, so AI companies now buy GPUs by the hundred thousand, and the top maker (Nvidia) became one of the world's most valuable companies." },
  { t: "What is prompt engineering?", f: "Prompt engineering is the craft of phrasing AI requests to get great results. Three big levers: give context (\"I run a small phone shop in KZN\"), be specific about the output (\"a 5-line WhatsApp message\"), and give an example of what good looks like." },
  { t: "What is 'vibe coding'?", f: "Vibe coding is building software by describing what you want to an AI in plain English and letting it write all the code — no programming knowledge needed. You react to what it builds (\"make the button bigger\", \"add a leaderboard\") like directing a builder. It's how this app exists." },
  { t: "What is a README?", f: "A README is the welcome note in a code project — what it is, how to run it, how to help. On GitHub it displays automatically on the project's front page. The name is an instruction: read me (first)." },
  { t: "What is Markdown?", f: "Markdown is a way to format text with simple symbols: *asterisks* for bold-ish emphasis, # for headings, - for bullet lists. It's what you write in WhatsApp when you use *stars* for bold — and what most READMEs, and Claude's answers, are written in." },
  { t: "What do version numbers mean?", f: "Software versions like 2.4.1 follow a pattern: the first number is big changes, the second is new features, the third is small fixes. So 2.4.1 → 2.4.2 is a tiny patch, but 2.x → 3.0 might change everything. It's called semantic versioning." },
  { t: "What is a 404?", f: "Every web request gets a status code back: 200 means OK, 404 means \"page not found\", 500 means the server itself broke. 404 is the famous one — you asked for a page that doesn't exist, often because of a typo or a dead link." },
  { t: "What is an IP address?", f: "An IP address is a device's number on a network, like 196.11.240.5 — the internet's version of a street address. Domain names exist purely so humans don't have to memorise these numbers." },
  { t: "What is RAG?", f: "RAG (Retrieval-Augmented Generation) is how AI assistants answer questions about your documents: first fetch the relevant pages from a library, then have the AI answer using what it just read. It keeps answers grounded in real sources instead of memory." },
  { t: "What is no-code?", f: "No-code tools let you build apps by dragging blocks around instead of writing code — think website builders like Wix, or automation tools like Zapier. AI tools like Claude have pushed this further: now plain English is the interface." },
];

// ---------------------------------------------------------------------------
// MTN 101 — daily knowledge about the yellow company (rotates daily)
// ---------------------------------------------------------------------------
const MTN_FACTS = [
  { t: "What does MTN stand for?", f: "MTN is short for Mobile Telephone Networks. The company started in South Africa in 1994, making it one of the very first mobile networks on the African continent." },
  { t: "Y'ello!", f: "MTN's famous greeting \"Y'ello!\" is a mash-up of \"yellow\" and \"hello\" — the brand's way of answering the phone. The bright yellow was chosen to feel bold, warm and optimistic." },
  { t: "Africa's biggest network", f: "MTN is the largest mobile network in Africa, serving hundreds of millions of people across roughly 19 markets in Africa and the Middle East." },
  { t: "Nigeria is number one", f: "South Africa is MTN's home, but Nigeria is its biggest market by far — more MTN subscribers live there than anywhere else." },
  { t: "MTN MoMo", f: "MoMo is MTN's mobile money service: people can send money, save and pay bills straight from a basic phone, no bank account needed. Tens of millions of Africans use it — for many, it IS their bank." },
  { t: "World Cup first", f: "In 2010, MTN became the first African company ever to be a global sponsor of the FIFA World Cup — fitting, since the tournament was hosted in South Africa that year." },
  { t: "The MTN8", f: "The MTN8 is South Africa's oldest football cup competition, contested by the top eight PSL teams — and it's carried MTN's name and yellow branding for years." },
  { t: "Tour de France history", f: "Team MTN-Qhubeka became the first African cycling team to ride the Tour de France in 2015 — a big yellow moment on the world's biggest cycling stage." },
  { t: "Where is MTN's home?", f: "MTN's head office is in Fairland, Johannesburg — the campus is often just called \"14th Avenue\". The group is listed on the Johannesburg Stock Exchange." },
  { t: "Everywhere you go", f: "MTN's classic slogan was \"Everywhere you go\" — the line most South Africans still associate with the brand today." },
  { t: "The 2022 rebrand", f: "In recent years MTN flattened its logo into a simple minimalist design — easier to read on small screens and app icons. Same yellow, cleaner look, built for the digital era." },
  { t: "Ayoba", f: "MTN built its own messaging app called Ayoba — chat, channels and music, designed for African users, and data-free for MTN customers in many markets." },
  { t: "The prepaid revolution", f: "MTN helped popularise prepaid, pay-as-you-go airtime in Africa. Before prepaid, you needed a contract and a credit check — prepaid made mobile phones affordable for everyone." },
  { t: "One of the first two", f: "When South Africa licensed GSM networks in 1993, only two licences were issued — one went to MTN, the other to Vodacom. The rivalry has been running ever since." },
  { t: "Owning a piece of MTN", f: "Through BEE share schemes like MTN Zakhele, ordinary South Africans have been able to buy shares and own a slice of the yellow company." },
  { t: "5G since 2020", f: "MTN switched on commercial 5G in South Africa in 2020 and has been rolling it out across cities since — 5G can be several times faster than 4G on a good day." },
  { t: "The street network", f: "A huge part of MTN's business runs through informal traders — street vendors and spaza shops selling airtime and data vouchers. Millions of small businesses earn income this way." },
  { t: "More than calls", f: "Modern MTN earns from far more than voice calls: data, fintech (MoMo), enterprise services and even renting space on its towers to other networks." },
];
function mtnFactOfTheDay(date) {
  return MTN_FACTS[dayNumber(date) % MTN_FACTS.length];
}

// ---------------------------------------------------------------------------
// Phone world — cellphone facts (Samsung, iPhone, Honor & friends).
// Used when there's no fresh MTN news, so the brief always teaches something.
// ---------------------------------------------------------------------------
const PHONE_FACTS = [
  { t: "Samsung is everywhere", f: "Samsung sells more phones than any other brand most years — and it also makes screens, memory chips and camera parts that its rivals use. There are Samsung parts inside many iPhones." },
  { t: "The first iPhone had no App Store", f: "When the iPhone launched in 2007 there was no App Store at all — it only arrived a year later, in 2008. Today apps are the whole point of a smartphone." },
  { t: "Where did Honor come from?", f: "Honor started life as Huawei's youth brand. In 2020 it was sold off and became an independent company — which is why Honor phones have full Google apps while Huawei's don't." },
  { t: "Why Huawei lost Google", f: "US sanctions in 2019 cut Huawei off from Google's apps and services. Huawei responded by building its own operating system, HarmonyOS, now on millions of devices in China." },
  { t: "Xiaomi started with software", f: "Xiaomi didn't start as a phone maker — it began by building MIUI, a slick version of Android, and only later made its own hardware. Today it's a top-three phone brand worldwide." },
  { t: "Megapixels aren't everything", f: "A 200MP camera isn't automatically better than a 50MP one. Sensor size, lens quality and the phone's software processing matter far more than the megapixel number on the box." },
  { t: "The first mobile call", f: "The first-ever mobile phone call was made in 1973 by Motorola engineer Martin Cooper — on a phone that weighed over a kilogram and took 10 hours to charge for 30 minutes of talking." },
  { t: "The best-selling phone ever", f: "It's not an iPhone — it's the humble Nokia 1100, which sold around 250 million units in the 2000s. Simple, tough, with a torch. A legend, especially across Africa." },
  { t: "What does IP68 mean?", f: "The IP rating on a phone tells you its dust and water resistance: the 6 means fully dust-tight, the 8 means it survives being underwater (usually 1.5m for 30 minutes). \"Resistant\" — not swim-proof forever." },
  { t: "Why every phone charges with USB-C now", f: "The EU passed a law forcing a common charger — which is why even Apple finally dropped its Lightning port and gave the iPhone 15 a USB-C port in 2023. One cable for everything." },
  { t: "What is an eSIM?", f: "An eSIM is a SIM card built into the phone itself. Instead of swapping a physical chip, you download your network profile — handy for travel, or for running two numbers on one phone." },
  { t: "Gorilla Glass is older than you think", f: "The tough glass on your phone screen is made by Corning — based on a super-strong glass they invented back in the 1960s. It sat mostly unused until Apple came knocking for the first iPhone." },
  { t: "60Hz vs 120Hz screens", f: "A 120Hz screen redraws itself 120 times a second — double the classic 60Hz — which is why scrolling looks silky-smooth on newer phones. The trade-off: it uses more battery." },
  { t: "Android is built on Linux", f: "Android — the system running Samsung, Honor, Xiaomi and most other phones — is based on Linux and is open source. Each brand adds its own skin on top, which is why they all look a bit different." },
  { t: "What does mAh actually mean?", f: "Battery size is measured in milliamp-hours (mAh) — roughly how much charge it holds. But screen, chip and software efficiency decide real battery life, which is why a 4,500mAh iPhone can outlast a 5,000mAh rival." },
  { t: "Fast charging, explained", f: "Charging speed is measured in watts. Old chargers were 5W; modern phones take 45W, 67W, even 120W — a few minutes plugged in can add hours of use. The phone controls the speed to protect the battery." },
];
function phoneFactOfTheDay(date) {
  return PHONE_FACTS[dayNumber(date) % PHONE_FACTS.length];
}

// ---------------------------------------------------------------------------
// Daily motivation — Zulu proverbs (with translations) + classic quotes
// ---------------------------------------------------------------------------
const QUOTES = [
  { q: "Umuntu ngumuntu ngabantu.", by: "Zulu proverb", tr: "A person is a person through other people." },
  { q: "It always seems impossible until it's done.", by: "Nelson Mandela" },
  { q: "Ithemba alibulali.", by: "Zulu proverb", tr: "Hope never kills — never lose hope." },
  { q: "Small steps every day add up to big journeys.", by: "" },
  { q: "Izandla ziyagezana.", by: "Zulu proverb", tr: "Hands wash each other — we rise by helping each other." },
  { q: "Do not judge me by my successes, judge me by how many times I fell down and got back up again.", by: "Nelson Mandela" },
  { q: "Indlela ibuzwa kwabaphambili.", by: "Zulu proverb", tr: "The way forward is asked from those who have walked it before." },
  { q: "Learning one new word a day is 365 words a year. Keep going.", by: "" },
  { q: "Inkunzi isematholeni.", by: "Zulu proverb", tr: "The future bull is among today's calves — greatness starts small." },
  { q: "The best time to plant a tree was 20 years ago. The second best time is now.", by: "Proverb" },
  { q: "Akukho qili lazikhotha emhlane.", by: "Zulu proverb", tr: "No one is clever enough to lick their own back — nobody succeeds alone." },
  { q: "Education is the most powerful weapon which you can use to change the world.", by: "Nelson Mandela" },
  { q: "Injobo enhle ithungelwa ebandla.", by: "Zulu proverb", tr: "A fine garment is sewn in company — good things are built together." },
  { q: "You don't have to be great to start, but you have to start to be great.", by: "Zig Ziglar" },
  { q: "A river cuts through rock not because of its power, but because of its persistence.", by: "James Watkins" },
  { q: "May your choices reflect your hopes, not your fears.", by: "Nelson Mandela" },
  { q: "Every expert was once a beginner.", by: "" },
  { q: "The secret of getting ahead is getting started.", by: "Mark Twain" },
  { q: "Little by little, a little becomes a lot.", by: "Tanzanian proverb" },
  { q: "If you want to go fast, go alone. If you want to go far, go together.", by: "African proverb" },
  { q: "Fall seven times, stand up eight.", by: "Japanese proverb" },
  { q: "Your streak doesn't care how you feel today — show up anyway.", by: "" },
  { q: "Smooth seas do not make skilful sailors.", by: "African proverb" },
  { q: "The sun does not forget a village just because it is small.", by: "African proverb" },
  { q: "A winner is a dreamer who never gives up.", by: "Nelson Mandela" },
  { q: "However long the night, the dawn will break.", by: "African proverb" },
  { q: "Knowledge is like a garden: if it is not cultivated, it cannot be harvested.", by: "African proverb" },
  { q: "Success is the sum of small efforts, repeated day in and day out.", by: "Robert Collier" },
];
function quoteOfTheDay(date) {
  return QUOTES[dayNumber(date) % QUOTES.length];
}

// ---------------------------------------------------------------------------
// Daily rotation — same pick for everyone on the same calendar day
// ---------------------------------------------------------------------------
function dayNumber(date) {
  const d = date || new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}
function zuluWordOfTheDay(date) {
  return ZULU_WORDS[dayNumber(date) % ZULU_WORDS.length];
}
function techFactOfTheDay(date) {
  return TECH_FACTS[dayNumber(date) % TECH_FACTS.length];
}

// ---------------------------------------------------------------------------
// MTN news via Google News RSS. Browsers block cross-site RSS fetches (CORS),
// so we go through free proxy services, trying each until one works.
// Parsed with regex (not DOMParser) so it also works inside the service worker.
// ---------------------------------------------------------------------------
// Topic searches — each is a fresh Google News web search, run daily.
const NEWS_TOPICS = [
  { id: "latest",  label: "Latest MTN",    q: '"MTN" telecom OR "MTN Group" OR "MTN South Africa"' },
  { id: "deals",   label: "Deals & specials", q: '"MTN" deals OR "MTN" specials OR "MTN" contract OR "MTN" prepaid' },
  { id: "network", label: "Network & 5G",  q: '"MTN" 5G OR "MTN" network OR "MTN" coverage OR "MTN" fibre' },
  { id: "phones",  label: "Phone world",   q: "smartphone Samsung OR iPhone OR Honor OR Huawei OR Xiaomi South Africa" },
];

function rssUrlFor(query) {
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(query) +
    "&hl=en-ZA&gl=ZA&ceid=ZA:en";
}
const NEWS_RSS_URL = rssUrlFor(NEWS_TOPICS[0].q);

const NEWS_PROXIES = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .trim();
}

function parseRssItems(xml, max) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const title = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (b.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const source = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1];
    if (!title) continue;
    items.push({
      title: decodeEntities(title),
      link: link ? decodeEntities(link) : "#",
      pub: pub ? new Date(decodeEntities(pub)) : null,
      source: source ? decodeEntities(source) : "",
    });
    if (items.length >= max) break;
  }
  return items;
}

// Is this app running on Netlify (where our own little server
// helpers exist)? GitHub Pages has no functions, so we skip them.
function hasNetlifyFunctions() {
  const h = (typeof location !== "undefined" && location.hostname) || "";
  return !/github\.io$/i.test(h) && h !== "";
}

async function fetchWithTimeout(url, ms) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms || 12000) : null;
  try {
    return await fetch(url, controller ? { signal: controller.signal } : {});
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchNewsByQuery(query, max) {
  max = max || 6;
  const url = rssUrlFor(query);
  let lastErr = null;

  // 1. Our own Netlify helper first — fastest and most reliable
  if (hasNetlifyFunctions()) {
    try {
      const res = await fetchWithTimeout(
        "/.netlify/functions/news?q=" + encodeURIComponent(query), 12000);
      if (res.ok) {
        const items = parseRssItems(await res.text(), max);
        if (items.length) return items;
      }
    } catch (e) { lastErr = e; }
  }

  // 2. Free public proxies as a backup (also covers GitHub Pages)
  for (const wrap of NEWS_PROXIES) {
    try {
      const res = await fetchWithTimeout(wrap(url), 12000);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const items = parseRssItems(await res.text(), max);
      if (items.length) return items;
      throw new Error("no items parsed");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all news sources failed");
}

function fetchMtnNews(max) { return fetchNewsByQuery(NEWS_TOPICS[0].q, max); }
function fetchPhoneNews(max) { return fetchNewsByQuery(NEWS_TOPICS[3].q, max); }

// ---------------------------------------------------------------------------
// AI mode, server-side (Netlify). The API key lives in Netlify's settings,
// never on the phone. Returns null when the site has no AI set up, so the
// app can quietly fall back to plain headlines.
// ---------------------------------------------------------------------------
async function fetchAiBriefServer() {
  if (!hasNetlifyFunctions()) return null;
  let res;
  try {
    res = await fetchWithTimeout("/.netlify/functions/brief", 45000);
  } catch (e) {
    return null; // no function deployed / offline — not an error worth showing
  }
  if (res.status === 404 || res.status === 503) return null;
  let data = {};
  try { data = await res.json(); } catch (e) { return null; }
  if (data.brief) return data.brief;
  if (data.error && res.status !== 200) throw new Error(data.error);
  return null;
}

// ---------------------------------------------------------------------------
// Optional AI mode — a real Claude agent that searches today's web for MTN
// news and writes a summary. Needs the user's own Anthropic API key
// (stored only on this device). Uses Claude Opus with the web-search tool.
// ---------------------------------------------------------------------------
async function fetchAiBrief(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages: [{
        role: "user",
        content:
          "Search the web for today's news about MTN (the African mobile telecommunications company, " +
          "MTN Group / MTN South Africa). Then write a friendly morning-brief summary: 3 to 5 short " +
          "bullet points of the most interesting recent MTN news, each one or two sentences, plain " +
          "English, no jargon. If there is genuinely nothing new today, say so and summarise the most " +
          "recent notable stories instead. Reply with the bullet points only — no preamble.",
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body.error && body.error.message) || ("HTTP " + res.status);
    throw new Error(msg);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined this request — showing headlines instead.");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

// ---------------------------------------------------------------------------
// Shared leaderboard (Supabase). Optional — if config.js is left empty the
// app stays in solo mode and everything else works exactly the same.
// Talks to Supabase's REST API directly, so there's nothing to install.
// ---------------------------------------------------------------------------
function sbConfig() {
  const c = (typeof window !== "undefined" && window.SAWUBONA_CONFIG) ||
            (typeof self !== "undefined" && self.SAWUBONA_CONFIG) || null;
  if (!c) return null;
  const url = (c.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (c.SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  return { url, key, boardName: c.BOARD_NAME || "The shared board" };
}
function sbOn() { return sbConfig() !== null; }

function sbHeaders(extra) {
  const c = sbConfig();
  return Object.assign({
    apikey: c.key,
    Authorization: "Bearer " + c.key,
    "Content-Type": "application/json",
  }, extra || {});
}

// Save one finished game to the shared board.
async function sbSaveScore(entry) {
  const c = sbConfig();
  if (!c) return false;
  const res = await fetchWithTimeout2(c.url + "/rest/v1/sawubona_scores", 12000, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      player: String(entry.player).trim().slice(0, 20),
      score: entry.score,
      correct: entry.correct,
      total: entry.total,
      day: entry.d,
    }),
  });
  if (!res.ok) throw new Error("Supabase said " + res.status + " — check SETUP.md");
  return true;
}

// Read the board. scope: "today" | "all"
async function sbTopScores(scope, limit) {
  const c = sbConfig();
  if (!c) return [];
  let q = c.url + "/rest/v1/sawubona_scores" +
    "?select=player,score,correct,total,day,created_at" +
    "&order=score.desc,created_at.asc&limit=" + (limit || 200);
  if (scope === "today") q += "&day=eq." + dayNumber();
  const res = await fetchWithTimeout2(q, 12000, { headers: sbHeaders() });
  if (!res.ok) throw new Error("Supabase said " + res.status);
  return await res.json();
}

// Keep only each player's best game, so one person can't fill the whole board.
function bestPerPlayer(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = (r.player || "").trim().toLowerCase();
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

// Small helper so this section works in both the app and the service worker
async function fetchWithTimeout2(url, ms, opts) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms || 12000) : null;
  try {
    return await fetch(url, Object.assign({}, opts || {},
      controller ? { signal: controller.signal } : {}));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
