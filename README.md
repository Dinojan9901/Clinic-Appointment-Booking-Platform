# EC8208 – Software Architecture · CA01

**Architecture Analysis and Design Report** for **MediConnect**, a microservices-based
**clinic appointment booking platform**. Patients use a web application to find a doctor and
clinic, view available time slots, and book an appointment in advance; the consultation itself
takes place in person at the clinic, where the doctor records visit notes and issues digital
prescriptions.

This repository holds Continuous Assessment 01 (the architecture design report) for the
EC8208 Software Architecture module.

## Repository contents

| File | Description |
|------|-------------|
| `CA01_Architecture_Report.tex` | LaTeX source of the report |
| `CA01_Architecture_Report.pdf` | Compiled report (submission copy) |
| `.gitignore` | Ignores LaTeX build artifacts and editor/OS files |
| `README.md` | This file |

## Report overview

The report covers, in order:

1. **Introduction** – background, problem statement, and objectives
2. **Requirements Analysis** – functional and non-functional requirements, stakeholders
3. **Architecture Selection** – comparison of styles and the chosen microservices approach
4. **Architectural Design** – context, architecture, component, deployment, class, and
   data-flow diagrams (drawn in TikZ)
5. **Technology Stack Selection**
6. **Quality Attributes** – scalability, performance, security, availability, maintainability,
   reliability
7. **Conclusion**

## Building the PDF

Requires a LaTeX distribution (e.g. MiKTeX or TeX Live) with `pdflatex`.
Run twice so the table of contents and cross-references resolve:

```bash
pdflatex CA01_Architecture_Report.tex
pdflatex CA01_Architecture_Report.tex
```

## Group members

| Reg. No. | Name |
|----------|------|
| EG/2021/4487 | Dinojan V. |
| EG/2021/4566 | Jackshan Venujan G.S. |
| EG/2021/4825 | Tharshihan R. |
| EG/2021/4590 | Jegan T. |
| EG/2021/4434 | Bandara M.M.D.L. |
