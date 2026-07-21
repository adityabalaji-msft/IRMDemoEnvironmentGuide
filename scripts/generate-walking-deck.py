"""
Generate IRM Field Demo Walking Deck (.pptx)
Run: pip install python-pptx && python scripts/generate-walking-deck.py
Output: IRM-Field-Demo-Walking-Deck.pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# Brand colors
AZURE_BLUE = RGBColor(0x00, 0x78, 0xD4)
DARK_BLUE = RGBColor(0x00, 0x2B, 0x5C)
LIGHT_BLUE = RGBColor(0x50, 0xE6, 0xFF)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GRAY = RGBColor(0x6E, 0x6E, 0x6E)
LIGHT_GRAY = RGBColor(0xF3, 0xF2, 0xF1)
RED = RGBColor(0xD1, 0x34, 0x38)
GREEN = RGBColor(0x10, 0x7C, 0x10)
YELLOW = RGBColor(0xFF, 0xB9, 0x00)
BLACK = RGBColor(0x00, 0x00, 0x00)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)


def add_slide(title_text, subtitle_text=None, layout_idx=5):
    """Add a blank slide and return it."""
    slide = prs.slides.add_slide(prs.slide_layouts[layout_idx])
    return slide


def add_title_box(slide, text, top=Inches(0.4), left=Inches(0.6), width=Inches(12), height=Inches(1.0),
                  font_size=Pt(32), color=DARK_BLUE, bold=True):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = font_size
    p.font.color.rgb = color
    p.font.bold = bold
    return txBox


def add_body_text(slide, text, top=Inches(1.6), left=Inches(0.6), width=Inches(12), height=Inches(5.0),
                  font_size=Pt(18), color=BLACK):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = line
        p.font.size = font_size
        p.font.color.rgb = color
        p.space_after = Pt(6)
        if line.startswith('•'):
            p.level = 1
    return txBox


def add_speaker_note(slide, text):
    notes_slide = slide.notes_slide
    tf = notes_slide.notes_text_frame
    tf.text = text


def add_action_banner(slide, text, top=Inches(6.4)):
    """Add a colored banner indicating presenter action (switch to browser, portal, etc.)"""
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.4), top, Inches(12.5), Inches(0.7))
    shape.fill.solid()
    shape.fill.fore_color.rgb = AZURE_BLUE
    shape.line.fill.background()
    tf = shape.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(16)
    p.font.color.rgb = WHITE
    p.font.bold = True
    p.alignment = PP_ALIGN.CENTER


# ============================================================
# SLIDE 1: Title Slide
# ============================================================
slide = add_slide("", layout_idx=5)
# Background shape
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = DARK_BLUE
bg.line.fill.background()

add_title_box(slide, "Infrastructure Resiliency Manager", top=Inches(2.0), left=Inches(1.0),
              font_size=Pt(44), color=WHITE)
add_title_box(slide, "Field Demo Walking Deck", top=Inches(3.0), left=Inches(1.0),
              font_size=Pt(28), color=LIGHT_BLUE, bold=False)
add_title_box(slide, "Contoso Retail — From Blind Spots to Validated Zone Resilience",
              top=Inches(4.2), left=Inches(1.0), font_size=Pt(20), color=WHITE, bold=False)
add_title_box(slide, "Two live apps  •  Four demo acts  •  End-to-end resiliency journey",
              top=Inches(5.4), left=Inches(1.0), font_size=Pt(16), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Welcome slide. Introduce yourself and set context:
- "Today I'm going to show you how Infrastructure Resiliency Manager helps you go from blind spots to validated zone resilience."
- "We have two live applications deployed in Azure — one on AKS, one on VMs — and we'll walk through assessment, remediation, and drills."
""")

# ============================================================
# SLIDE 2: Agenda
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Demo Flow", font_size=Pt(36))
add_body_text(slide, """Act 1 — "Meet the Apps"
       Architecture & current zone resiliency state

Act 2 — "Discover Your Posture at Scale"
       IRM assessment: at-scale view → service group drill-down

Act 3 — "Close the Gaps"
       Copilot-powered remediation guidance + IaC generation

Act 4 — "Prove It Works"
       Zone down drills: AKS fault injection & VM recovery plan""", font_size=Pt(20))

add_speaker_note(slide, """Agenda overview. Keep this brief — 30 seconds max.
- "Four acts, each building on the last. We start by understanding the apps, then assess them, fix gaps, and finally prove it all works with live drills."
""")

# ============================================================
# SLIDE 3: Quick Reference
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Quick Reference — Demo Resources")
add_body_text(slide, """AKS App URL:          http://irm-demo-aks.eastus.cloudapp.azure.com
VM App URL:           http://irm-demo-vm.westus2.cloudapp.azure.com:8080

AKS Service Group:    IRMDemoSG2
VM Service Group:     IRMDemoSG3

AKS Resource Group:   zr-demo-rg-4
VM Resource Group:    zr-demo-vm-rg

Region (AKS):        East US
Region (VM):         West US 2""", font_size=Pt(18))

add_speaker_note(slide, """Reference slide — keep visible or memorize key URLs.
You'll open both app URLs in browser tabs before starting the demo.
Pre-open the IRM portal and navigate to the service groups list.""")

# ============================================================
# SLIDE 4: Act 1 Title
# ============================================================
slide = add_slide("", layout_idx=5)
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = AZURE_BLUE
bg.line.fill.background()
add_title_box(slide, "Act 1", top=Inches(2.5), left=Inches(1.0), font_size=Pt(52), color=WHITE)
add_title_box(slide, '"Meet the Apps"', top=Inches(3.5), left=Inches(1.0), font_size=Pt(36), color=WHITE, bold=False)
add_title_box(slide, "Architecture & Current Zone Resiliency State", top=Inches(4.5), left=Inches(1.0),
              font_size=Pt(20), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Transition to Act 1.
"Let me introduce you to two applications that Contoso Retail runs in Azure. Both are live right now."
""")

# ============================================================
# SLIDE 5: App A — AKS Architecture
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "App A — E-Commerce Platform (AKS Microservices)")
add_body_text(slide, """• Frontend pods: product catalog + blob storage for static assets
• Backend pods: order processing via Azure SQL
• Container images pulled from Azure Container Registry
• AKS cluster: 3 nodes across Availability Zones 1, 2, 3
• Standard Load Balancer routes traffic across zones

Zone Resiliency Status:
  ✅  AKS Cluster (zones 1/2/3)         ✅  Load Balancer (Standard)
  ✅  Container Registry (zone-redundant)
  ❌  Azure SQL Database (GP_Gen5_2 — no ZR)
  ❌  Storage Account (Standard_LRS — no ZR)""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO BROWSER → Open http://irm-demo-aks.eastus.cloudapp.azure.com")

add_speaker_note(slide, """Open the AKS app in browser. Show it's live.
Key point: "The compute layer looks resilient — nodes across 3 zones. But look at the dependencies:
SQL and Storage are NOT zone-redundant. If Zone 1 goes down, compute survives but data might not."

Let the audience absorb the gap between perceived and actual resilience.""")

# ============================================================
# SLIDE 6: App B — VM Architecture
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "App B — Inventory Management System (VM + ASR)")
add_body_text(slide, """• Monolithic Node.js app on a zone-pinned VM (Zone 1)
• Companion worker VM: data sync agent (also Zone 1)
• Azure Site Recovery: zonal DR (Zone 1 → Zone 2)
• Standard Public IP: zone-redundant by default

Zone Resiliency Status:
  ✅  Main VM (Zone 1, ASR replicates to Zone 2)
  ✅  Worker VM (Zone 1, ASR replicates to Zone 2)
  ✅  Public IP (Standard SKU — zone-redundant)
  ✅  ASR Vault (orchestrates zonal failover)
  ❌  Azure SQL Database (GP_Gen5_2 — no ZR)
  ❌  Storage Account (Standard_LRS — no ZR)""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO BROWSER → Open http://irm-demo-vm.westus2.cloudapp.azure.com:8080")

add_speaker_note(slide, """Open the VM app in browser. Show it's live.
Key point: "ASR is configured — the VMs CAN recover to Zone 2. But has this ever been tested?
Can Contoso orchestrate recovery in the right order under real pressure?
The worker must come up before the main app. That sequencing matters."

Pause: "These are the questions Infrastructure Resiliency Manager answers." """)

# ============================================================
# SLIDE 7: Act 1 Talking Point
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Key Message — Act 1")
add_body_text(slide, """"The AKS app looks resilient on the surface — nodes are
spread across zones. But what about the SQL database and
storage it depends on?

The VM app has ASR configured, so it CAN survive a zone
outage — but can the customer actually orchestrate the
recovery in the right order, under pressure?

Has it ever been tested?

These are the questions Infrastructure Resiliency Manager answers."
""", font_size=Pt(22), color=DARK_BLUE)

add_speaker_note(slide, """Pause on this slide. Let the message land.
This frames the rest of the demo — IRM answers these exact questions.""")

# ============================================================
# SLIDE 8: Act 2 Title
# ============================================================
slide = add_slide("", layout_idx=5)
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = AZURE_BLUE
bg.line.fill.background()
add_title_box(slide, "Act 2", top=Inches(2.5), left=Inches(1.0), font_size=Pt(52), color=WHITE)
add_title_box(slide, '"Discover Your Posture at Scale"', top=Inches(3.5), left=Inches(1.0),
              font_size=Pt(36), color=WHITE, bold=False)
add_title_box(slide, "Infrastructure Resiliency Manager — Assessment", top=Inches(4.5), left=Inches(1.0),
              font_size=Pt(20), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Transition: "Now let's see what IRM tells us about these applications."
Switch to the Azure Portal / IRM portal after this slide.""")

# ============================================================
# SLIDE 9: Act 2 — At-Scale View
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Step 1: At-Scale View")
add_body_text(slide, """Navigate to:  Resiliency → Resiliency Overview

What to show:
• Zone-resilient vs. non-resilient service groups (summary tiles)
• Total resource count broken down by posture
• Color-coded health across all service groups

Talking point:
"This is what a platform team sees when managing dozens of
applications — one pane of glass showing which apps meet
zone resilience goals and which don't."

Pre-created service groups:
  • IRMDemoSG2 → AKS app (Goals + Drill)
  • IRMDemoSG3 → VM app (Goals + Recovery Plan + Drill)""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO PORTAL → IRM: Resiliency Overview (at-scale view)")

add_speaker_note(slide, """Switch to portal now. Navigate to Resiliency Overview.
Point out the non-resilient service groups tile.
"Imagine you manage 50 applications — you need this single-pane view." """)

# ============================================================
# SLIDE 10: Act 2 — Drill into SG2 (AKS)
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Step 2: Drill into IRMDemoSG2 (AKS App)")
add_body_text(slide, """Click on non-resilient tile → select IRMDemoSG2

Per-resource breakdown:
  ✅  AKS Cluster, Load Balancer → Zone-resilient
  ❌  SQL Database, Storage Account → Non zone-resilient

Show recommendations for each non-resilient resource:
  • What needs to change
  • Qualitative cost indicator (Low / Medium / High)

Talking point:
"IRM automatically identifies which resources in this service
group meet zone resilience requirements and which don't —
with clear recommendations and cost implications." """, font_size=Pt(17))
add_action_banner(slide, "▶  STAY IN PORTAL → IRMDemoSG2 service group detail view")

add_speaker_note(slide, """In the portal, click into IRMDemoSG2.
Walk through the resource list — point to green checkmarks and red X's.
Click into a recommendation to preview what IRM suggests.""")

# ============================================================
# SLIDE 11: Act 2 — Drill into SG3 (VM)
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Step 3: Drill into IRMDemoSG3 (VM App)")
add_body_text(slide, """Navigate back → select IRMDemoSG3

Per-resource breakdown:
  ✅  VMs with ASR configured → Zone-resilient
  ❌  SQL Database, Storage → Non zone-resilient

Key differentiator:
  • Recovery Plan already associated for orchestrated failover
  • Shows sequencing: Worker first, then Main App

Talking point:
"Notice the recovery plan here — IRM doesn't just assess
individual resources, it understands orchestration needs.
For VMs, sequence matters." """, font_size=Pt(17))
add_action_banner(slide, "▶  STAY IN PORTAL → IRMDemoSG3 service group detail view")

add_speaker_note(slide, """Click into IRMDemoSG3. Point out the recovery plan section.
Highlight that ASR + recovery plan = zone-resilient status for VMs.
"Without the orchestrated plan, even ASR-protected VMs would be flagged." """)

# ============================================================
# SLIDE 12: Act 2 Key Talking Point
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Key Message — Act 2")
add_body_text(slide, """"Without this tool, you'd need to manually inspect each
resource's zone configuration — across every subscription,
every resource group.

With Infrastructure Resiliency Manager, you get:

  • A single aggregated view across all applications
  • Actionable recommendations with cost implications
  • Copilot-generated remediation scripts

All in one place."
""", font_size=Pt(22), color=DARK_BLUE)

add_speaker_note(slide, """Pause slide — let the value proposition sink in.
Transition: "Now let's look at how we actually fix these gaps." """)

# ============================================================
# SLIDE 13: Act 3 Title
# ============================================================
slide = add_slide("", layout_idx=5)
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = AZURE_BLUE
bg.line.fill.background()
add_title_box(slide, "Act 3", top=Inches(2.5), left=Inches(1.0), font_size=Pt(52), color=WHITE)
add_title_box(slide, '"Close the Gaps"', top=Inches(3.5), left=Inches(1.0),
              font_size=Pt(36), color=WHITE, bold=False)
add_title_box(slide, "Copilot-Powered Remediation Guidance", top=Inches(4.5), left=Inches(1.0),
              font_size=Pt(20), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Transition: "IRM told us what's wrong. Now let's fix it."
Stay in portal for this section — you'll demo the Copilot Resolve feature.""")

# ============================================================
# SLIDE 14: Act 3 — Recommendations Table
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Recommendations Overview")
add_body_text(slide, """Resource                    Recommendation              Cost     Effort
─────────────────────────────────────────────────────────────────────────
Azure SQL Database          Enable zone redundancy      Medium   Low
(both apps)                                                      (portal toggle)

Storage Accounts            Convert LRS → ZRS           Low      Medium
(both apps)                                                      (may need support)

These are surfaced automatically for every non-compliant resource.
Each includes a qualitative cost indicator so teams can prioritize.""", font_size=Pt(17))
add_action_banner(slide, "▶  STAY IN PORTAL → Show recommendations list in service group view")

add_speaker_note(slide, """Show the recommendations list in the portal.
Click on one to expand details. Then proceed to demo Copilot Resolve.""")

# ============================================================
# SLIDE 15: Act 3 — Copilot Resolve
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, 'Demo: Copilot "Resolve" Feature')
add_body_text(slide, """1. Select a SQL Database recommendation
2. Click "Resolve" to open the Copilot agent

Copilot guides the user step by step to understand:

  • What can be fixed in place
    (e.g., portal toggle to enable zone redundancy)

  • What needs to be redeployed via script or automation
    (e.g., storage account LRS → ZRS conversion)

  • What requires manual effort
    (e.g., architecture changes, support requests)

The user can also prompt the agent to generate an IaC template
(Bicep) with the right resiliency controls already enabled —
ready to deploy or integrate into existing CI/CD pipelines.""", font_size=Pt(17))
add_action_banner(slide, "▶  STAY IN PORTAL → Click 'Resolve' on a recommendation")

add_speaker_note(slide, """Click Resolve on the SQL Database recommendation.
Walk through the Copilot response — show the categorization.
If time allows, prompt: "Generate a Bicep template with zone redundancy enabled for this SQL database."
Show the IaC output.""")

# ============================================================
# SLIDE 16: Act 3 Key Talking Point
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Key Message — Act 3")
add_body_text(slide, """"Infrastructure Resiliency Manager doesn't just tell you
what's wrong — Copilot walks you through each fix,
categorizes the effort, and can even generate
deployment-ready IaC templates with zone-redundancy
baked in."
""", font_size=Pt(24), color=DARK_BLUE)

add_speaker_note(slide, """Pause — let value land.
Transition: "Assessment done. Remediation planned. But how do we PROVE it works?" """)

# ============================================================
# SLIDE 17: Act 4 Title
# ============================================================
slide = add_slide("", layout_idx=5)
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = AZURE_BLUE
bg.line.fill.background()
add_title_box(slide, "Act 4", top=Inches(2.5), left=Inches(1.0), font_size=Pt(52), color=WHITE)
add_title_box(slide, '"Prove It Works"', top=Inches(3.5), left=Inches(1.0),
              font_size=Pt(36), color=WHITE, bold=False)
add_title_box(slide, "Zone Down Drills — Live Fault Injection & Recovery", top=Inches(4.5), left=Inches(1.0),
              font_size=Pt(20), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Transition: "This is the most impactful part of the demo.
We're going to simulate an actual zone failure and prove our apps survive."

Build anticipation — this is the 'wow' moment.""")

# ============================================================
# SLIDE 18: Act 4a — AKS Drill Setup
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Drill: AKS App (IRMDemoSG2)")
add_body_text(slide, """Goal: Prove AKS compute layer survives a zone failure

Navigate to: IRMDemoSG2 → Resiliency → Drills (pre-created)

Fault Designer shows:
  ✅  AKS Cluster — included for fault injection
       (node shutdown in target zone via Chaos Studio)
  ⛔  SQL Database — excluded from drill
       (non-ZR, would cause expected failures)

Why exclude SQL?
"We focus on validating what IS resilient first. Once SQL is
upgraded to zone-redundant, we'll add it to the drill scope."
""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO PORTAL → IRMDemoSG2 → Drills → Fault Designer")

add_speaker_note(slide, """Navigate to IRMDemoSG2 drills. Show the fault designer.
Point out which resources are in scope and which are excluded.
Explain the philosophy: validate what should work, exclude known gaps.""")

# ============================================================
# SLIDE 19: Act 4a — AKS Drill Execution
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "AKS Drill — Execution & Validation")
add_body_text(slide, """Execute the drill targeting Zone 1:

1. AKS node pool VMs in Zone 1 shut down (Chaos Studio)
2. Load Balancer detects unhealthy nodes
3. Traffic routes to zones 2 and 3 automatically
4. Pods reschedule to healthy nodes

Validation:
• Open app URL — it continues serving ✅
• Monitor per-resource health in drill execution job
• End drill — nodes return, pods rebalance

Expected result: ZERO downtime for the application""", font_size=Pt(18))
add_action_banner(slide, "▶  SWITCH TO BROWSER → Verify app at http://irm-demo-aks.eastus.cloudapp.azure.com")

add_speaker_note(slide, """Execute the drill in portal (or show a pre-recorded execution if time-constrained).
Switch to browser — refresh the app to show it's still serving.
"The app stayed up because AKS has nodes in other zones. The LB handled rerouting automatically."
Back to portal to show drill metrics/results.""")

# ============================================================
# SLIDE 20: Act 4a — AKS Key Point
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "AKS Drill — Key Takeaway")
add_body_text(slide, """"We excluded the non-resilient SQL DB and focused on
validating what we know should survive.

The app stayed up because AKS compute is zone-redundant.

Next step: make SQL zone-redundant too, then run the
full drill with all resources in scope."
""", font_size=Pt(22), color=DARK_BLUE)

add_speaker_note(slide, """Pause. Then transition:
"Now let's look at the VM scenario — this is more dramatic because the app actually goes DOWN." """)

# ============================================================
# SLIDE 21: Act 4b — VM Drill Setup
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Drill: VM App (IRMDemoSG3)")
add_body_text(slide, """Goal: Prove the orchestrated recovery plan brings the app
back in the correct sequence

Navigate to: IRMDemoSG3 → Resiliency → Drills (pre-created)

Key elements:
  • Drill + Recovery Plan pre-configured
  • Recovery sequence defined:
      1st → Worker VM (data sync must be ready first)
      2nd → Main App VM (depends on worker)
  • ASR handles: disk replication, IP reassignment, VM boot

What happens when we execute:
  • Both VMs in Zone 1 shut down
  • App goes completely dark (unlike AKS!)""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO PORTAL → IRMDemoSG3 → Drills")

add_speaker_note(slide, """Navigate to IRMDemoSG3 drills. Show the recovery plan configuration.
Point out the sequencing: "Worker first, then main app. Order matters."
Execute the drill — or narrate what happens if time is tight.""")

# ============================================================
# SLIDE 22: Act 4b — VM Drill Execution
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "VM Drill — Execution & Recovery")
add_body_text(slide, """Execute drill targeting Zone 1:
  → VMs shut down → App goes DARK ❌

Execute the Recovery Plan (orchestrated sequence):
  1. Worker VM fails over to Zone 2 (data sync agent ready)
  2. Main App VM fails over to Zone 2 (app depends on worker)
  3. ASR handles disk replication, IP reassignment, boot

Validate recovery:
  • App comes back on Zone 2 ✅
  • Check health endpoint for SQL + Storage connectivity
  • Measure RTO from drill metrics

After validation:
  • Reprotect (Zone 2 → Zone 1) for future drills""", font_size=Pt(17))
add_action_banner(slide, "▶  SWITCH TO BROWSER → Verify app returns at VM URL after recovery")

add_speaker_note(slide, """This is the dramatic moment — the app actually goes down and comes back.
Show the recovery plan executing in portal.
Switch to browser once recovery completes to show app is live again.
Highlight the measured RTO in drill results.""")

# ============================================================
# SLIDE 23: Act 4b — VM Key Point
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "VM Drill — Key Takeaway")
add_body_text(slide, """"ASR gives you the CAPABILITY to recover. But without a
tested, orchestrated recovery plan, you're guessing at
sequencing under pressure during a real outage.

The pre-built recovery plan ensures VMs come up in the
right order, every time.

And metrics during the drill tell you exactly how long
recovery took — your measured RTO."
""", font_size=Pt(22), color=DARK_BLUE)

add_speaker_note(slide, """Let this land. This is the "aha" moment for VM-heavy customers.
"How many of your customers have ASR configured but have never tested the actual recovery sequence?" """)

# ============================================================
# SLIDE 24: Summary
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "The Customer Journey — Summary")
add_body_text(slide, """Demo Act                    IRM Capability                   Customer Value
──────────────────────────────────────────────────────────────────────────────────
Act 1 — Meet the Apps       Architecture awareness           Understand what you have

Act 2 — Discover Posture    At-Scale View → SG Posture       Single pane of glass

Act 3 — Close Gaps          Recommendations + Copilot        Prioritized remediation
                            IaC template generation          with deployment-ready code

Act 4a — AKS Drill          Zone Down Fault Injection        Validated zone-spread
                                                             compute works

Act 4b — VM Drill           Orchestrated Recovery Plan       Proven sequenced recovery
                                                             with measured RTO""", font_size=Pt(16))

add_speaker_note(slide, """Summary slide — quick recap.
"We went from understanding the architecture, to assessing posture at scale,
to getting AI-powered fix guidance, to actually proving it works in production.
That's the full IRM journey." """)

# ============================================================
# SLIDE 25: Call to Action
# ============================================================
slide = add_slide("", layout_idx=5)
bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(7.5))
bg.fill.solid()
bg.fill.fore_color.rgb = DARK_BLUE
bg.line.fill.background()
add_title_box(slide, "Next Steps", top=Inches(2.0), left=Inches(1.0), font_size=Pt(40), color=WHITE)
add_body_text(slide, """• Identify 2-3 critical applications to onboard as Service Groups

• Run an assessment — see your zone resiliency posture today

• Create your first drill — prove what works, find what doesn't

• Use Copilot to generate remediation templates for gaps""",
              top=Inches(3.2), left=Inches(1.0), font_size=Pt(22), color=WHITE)
add_title_box(slide, "Contact: azureresiliency@microsoft.com", top=Inches(6.2), left=Inches(1.0),
              font_size=Pt(18), color=LIGHT_BLUE, bold=False)

add_speaker_note(slide, """Close with actionable next steps.
Offer to help them set up their first service group and run their first drill.
Leave contact info on screen.""")

# ============================================================
# SLIDE 26: Appendix — Pre-Demo Checklist
# ============================================================
slide = add_slide("", layout_idx=5)
add_title_box(slide, "Appendix: Pre-Demo Checklist")
add_body_text(slide, """Before presenting, verify:

  □  AKS app is live: http://irm-demo-aks.eastus.cloudapp.azure.com
  □  VM app is live: http://irm-demo-vm.westus2.cloudapp.azure.com:8080
  □  IRM portal loads and shows IRMDemoSG2 + IRMDemoSG3
  □  Pre-open browser tabs: both app URLs + IRM portal
  □  ASR replication is healthy (portal → Recovery Services vault)
  □  Drill definitions exist in both service groups

If AKS app is down:
  • Check: az aks get-credentials + kubectl get pods
  • Pods may need restart after a previous drill

If VM app is down:
  • Check: az vm run-command (see setup-readme.md)
  • May need to restart the scenario6 systemd service""", font_size=Pt(16))

add_speaker_note(slide, """Hidden slide for presenter prep only. Don't show this during the demo.
Run through this checklist 30 minutes before your session.""")

# Save
output_path = "IRM-Field-Demo-Walking-Deck.pptx"
prs.save(output_path)
print(f"✅ Generated: {output_path}")
print(f"   Slides: {len(prs.slides)}")
