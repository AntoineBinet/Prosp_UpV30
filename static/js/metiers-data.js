/* ═══════════════════════════════════════════════════════════════
   metiers-data.js
   Référentiel métiers Up Technologies — données partagées
   Utilisé par : metiers.html, app.js (fiche prospect)
   ═══════════════════════════════════════════════════════════════ */

const METIERS_DATA = [
  {
    name: "Ingénierie Logicielle",
    icon: "💻",
    color: "#6366f1",
    specialties: [
      {
        name: "Logiciel applicatif",
        ops: "Analyse des exigences fonctionnelles et techniques, conception architecture logicielle, développement et intégration, rédaction documentation technique.",
        tech: {
          "Langages": ["C", "C++", "Java", "Python", "C#", "Javascript", "Bash"],
          "Systèmes": ["Linux", "Windows", "WSL", "GNU", "UNIX", "Debian", "CentOS", "Ubuntu"],
          "IDE": ["Visual Studio", "Eclipse", "IntelliJ IDEA", "PyCharm", "Qt Creator"],
          "Bases de données": ["Oracle", "MySQL", "SQL", "NoSQL", "MongoDB", "Elasticsearch", "PostgreSQL"],
          "Méthodologies": ["UML", "Cycle en V", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["SCADA", "JIRA", "Git", "GitLab", "AWS", "Unity", "Unreal Engine", "Bitbucket"],
          "Librairies": ["Qt", ".NET", "OpenGL", "OpenCV"],
          "Protocoles": ["TCP/IP", "Ethernet", "Bluetooth", "Wifi"],
          "Capteurs": ["Lidar", "ADAS", "GNSS", "GPS", "Caméra", "Radar", "Infrarouge"],
          "Frameworks": ["WPF", "ASP.NET", "ROS"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire", "Défense", "Télécommunications"]
      },
      {
        name: "Test / Validation / Qualification logicielle",
        ops: "Élaboration de la stratégie de validation, rédaction et exécution des plans de tests, gestion des anomalies, qualification logicielle.",
        tech: {
          "Langages": ["Python", "TCL", "Java", "Javascript", "C#", "Perl", "RUST", "Go"],
          "Systèmes": ["Linux", "Windows", "WSL", "GNU", "UNIX", "Debian", "CentOS", "Ubuntu"],
          "IDE": ["Visual Studio", "Eclipse", "IntelliJ IDEA", "PyCharm", "Qt Creator"],
          "Méthodologies": ["UML", "Cycle en V", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["LabVIEW", "SCADA", "TestStand", "Bitbucket"],
          "Protocoles": ["TCP/IP", "CAN", "LAN", "WAN", "Bluetooth", "LoRa", "Wifi", "I2C", "SPI", "UART"],
          "Frameworks": ["RobotFramework", "Selenium"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire", "Spatial", "Nucléaire"],
        certifs: ["ISTQB"]
      },
      {
        name: "Logiciels embarqués / Systèmes embarqués / IoT",
        ops: "Conception des fonctionnalités logicielles, architecture, programmation bas niveau, développement drivers et BSP, intégration matérielle.",
        tech: {
          "Langages": ["C", "C++", "Python", "Bash", "C#"],
          "Systèmes": ["UNIX", "Linux", "Kernel Linux", "RTOS", "FreeRTOS", "Windows", "Zephyr", "Debian"],
          "IDE": ["Visual Studio", "Eclipse", "Vivado", "Arduino IDE", "STM32CubeIDE", "Atollic Studio"],
          "Méthodologies": ["UML", "Cycle en V", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["Yocto", "Buildroot", "Xenomaï", "AUTOSAR", "LabVIEW", "SCADA", "Bitbucket"],
          "Librairies": ["Qt", "OpenCV", "OpenGL", "STM32Cube", "CMSIS", "HAL"],
          "Protocoles": ["TCP/IP", "CAN", "LAN", "WAN", "Bluetooth", "LoRa", "Wifi", "I2C", "SPI", "UART", "Modbus", "MQTT"],
          "Microcontrôleurs": ["STM32", "Microchip", "NXP", "ESP", "Raspberry Pi", "Texas Instruments", "DSP"],
          "Capteurs": ["Lidar", "ADAS", "GNSS", "GPS", "Caméra", "Radar", "Infrarouge"],
          "Frameworks": ["Gstreamer", "ASP.NET", "ROS"],
          "Matériel": ["PLC", "API Siemens", "Allen-Bradley", "Schneider"]
        },
        sectors: ["Automobile", "Aéronautique", "IoT", "Drones", "Défense", "Ferroviaire", "Énergie"]
      },
      {
        name: "Data Science / ML / Deep Learning / Vision",
        ops: "Développement Python, algorithmes de traitement de données, classification, réseaux de neurones, traitement d'images, computer vision.",
        tech: {
          "Langages": ["Python", "R", "Scala", "C++", "Java", "Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX", "GNU", "Ubuntu", "Debian"],
          "IDE": ["Jupyter", "Spyder", "Visual Studio", "DataSpell"],
          "Méthodologies": ["UML", "Cycle en V", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["Pytorch", "Elasticsearch", "Anaconda", "Git", "PowerBI", "VBA", "Kafka", "Spark", "PostgreSQL"],
          "Librairies": ["OpenCV", "TensorFlow", "Pandas", "Keras", "NumPy"],
          "Capteurs": ["Lidar", "ADAS", "GNSS", "GPS", "Caméra", "Radar", "Infrarouge"],
          "Frameworks": ["Hadoop"]
        },
        sectors: ["Automobile", "Aéronautique", "Semiconducteurs", "Dispositifs médicaux"]
      },
      {
        name: "DevOps / Infrastructure / Cloud",
        ops: "Développement d'environnements de tests et de production, supervision de l'infrastructure, CI/CD, automatisation des déploiements.",
        tech: {
          "Langages": ["C++", "Python", "C#", "Javascript", "Typescript", "Bash", "PowerShell"],
          "Systèmes": ["Windows", "Linux", "UNIX", "GNU", "Ubuntu", "Debian"],
          "Bases de données": ["Oracle", "MySQL", "SQL", "NoSQL", "MongoDB", "Elasticsearch", "PostgreSQL"],
          "Serveurs": ["Cloud AWS", "Cloud GCP", "Cloud Azure"],
          "Méthodologies": ["UML", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["Docker", "Jenkins", "GitLab", "Git", "Ansible", "Terraform", "JIRA", "VMWare", "CMake", "Cucumber"]
        },
        sectors: ["Télécommunications", "Énergie", "Automobile"],
        certifs: ["AWS", "Azure", "Kubernetes"]
      },
      {
        name: "Automatisme / Robotique Industrielle",
        ops: "Analyse fonctionnelle, conception et réalisation de schémas, programmation d'automates, mise en service, supervision industrielle.",
        tech: {
          "Langages": ["Python", "Matlab", "Ladder"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "IDE": ["CoDeSys", "Visual Studio"],
          "Méthodologies": ["Cycle en V", "Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["LabVIEW", "Siemens STEP7", "SIMATIC", "WinCC", "TIA Portal"],
          "Librairies": ["OpenCV"],
          "Protocoles": ["TCP/IP", "Ethernet", "Modbus", "MQTT", "OPC", "UART", "Bluetooth", "BLE", "Zigbee"],
          "Frameworks": ["RobotFramework", "ROS"],
          "Matériel": ["PLC", "API Siemens", "Allen-Bradley", "Schneider"]
        },
        sectors: ["Production et robots industriels", "Automobile", "Énergie", "Agricole"]
      },
      {
        name: "Gestion de projet logiciel / Scrum Master",
        ops: "Pilotage des activités de développement, interface avec les fournisseurs, gestion planning et budget, reporting, coordination d'équipe.",
        tech: {
          "Méthodologies": ["Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["MS Project", "Tuleap", "JIRA", "Qlik Sense", "PowerBI", "Confluence"]
        },
        sectors: ["Tous secteurs"],
        certifs: ["PMP", "CSM", "PSM", "SAFe"]
      },
      {
        name: "Développement Web / Fullstack",
        ops: "Développement frontend, développement backend, design de l'expérience utilisateur, intégration API, déploiement.",
        tech: {
          "Langages": ["HTML", "CSS", "Javascript", "Golang", "Java", "jQuery", "Django", "Typescript", "Python"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "IDE": ["Electron"],
          "Bases de données": ["Oracle", "MySQL", "SQL", "NoSQL", "MongoDB", "Elasticsearch", "PostgreSQL"],
          "Méthodologies": ["Agile", "SCRUM", "LEAN", "Kanban"],
          "Outils": ["Node", "Figma", "Git", "GitLab", "Redmine", "JEE"],
          "Librairies": ["React", "JavaFX", "jQuery"],
          "Frameworks": ["React", "Angular", "Spring", "Spring Boot", "Vue.js", "Hibernate"]
        },
        sectors: ["Télécommunications", "Énergie"]
      }
    ]
  },
  {
    name: "Ingénierie Électronique",
    icon: "⚡",
    color: "#f59e0b",
    specialties: [
      {
        name: "Électronique analogique",
        ops: "Systèmes électroniques traitant des données continues (capteurs, amplification, filtrage), conception circuits analogiques, caractérisation.",
        tech: {
          "Langages": ["Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V"],
          "Outils CAO": ["Eagle", "Proteus", "DesignSpark", "Altium Designer", "KiCad"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"],
          "Microcontrôleurs": ["NXP", "Microchip", "Analog Devices", "ARM Cortex", "STM32", "Arduino"],
          "Capteurs": ["Capteurs analogiques", "Instrumentation", "Infrarouge", "Accéléromètre"],
          "Matériel": ["Oscilloscope", "Générateurs de signaux", "Analyseur de spectre", "Source de mesure"]
        },
        sectors: ["Automobile", "Aéronautique", "Électronique", "Semiconducteurs"],
        certifs: ["CID"]
      },
      {
        name: "Électronique numérique",
        ops: "Systèmes numériques (transmission binaire), conception PCB, routage, prototypage, validation de cartes électroniques.",
        tech: {
          "Langages": ["Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V"],
          "Outils CAO": ["Eagle", "Proteus", "DesignSpark", "Altium Designer", "KiCad"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"],
          "Microcontrôleurs": ["NXP", "Microchip", "Analog Devices", "ARM Cortex", "STM32", "Arduino", "DSP"],
          "Capteurs": ["Instrumentation", "Infrarouge", "Accéléromètre", "Capteur de lumière"],
          "Matériel": ["PCB", "Oscilloscope", "Générateurs de signaux", "Analyseur de spectre"]
        },
        sectors: ["Automobile", "Aéronautique", "Électronique", "Semiconducteurs"],
        certifs: ["CID"]
      },
      {
        name: "Électronique de puissance",
        ops: "Gestion d'alimentation, définition des spécifications des convertisseurs, moteurs, dimensionnement des composants de puissance.",
        tech: {
          "Langages": ["Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V"],
          "Outils": ["MathCAD", "Eagle", "Proteus", "DesignSpark", "Altium Designer"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"],
          "Microcontrôleurs": ["NXP", "Microchip", "Analog Devices", "ARM Cortex", "STM32", "Arduino", "DSP"],
          "Matériel": ["Carte d'alimentation", "Convertisseur DC/DC", "Convertisseur AC/DC", "Turboalternateur"]
        },
        sectors: ["Automobile", "Énergie", "Ferroviaire", "Électrique"]
      },
      {
        name: "Génie électrique / Électrotechnique",
        ops: "Architecture des câblages électriques, câblage, conception de systèmes électriques, intégration et dimensionnement.",
        tech: {
          "Langages": ["Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V"],
          "Outils CAO": ["SEE ELECTRICAL", "AutoCAD", "3D Panel", "CANECO", "ETAP", "SolidWorks"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"],
          "Microcontrôleurs": ["NXP", "Microchip", "Analog Devices", "ARM Cortex", "STM32", "Arduino"],
          "Capteurs": ["Capteur de tension", "Capteur de courant"],
          "Matériel": ["Oscilloscope", "Analyseur logique", "Multimètre", "Ampèremètre"]
        },
        sectors: ["Énergie", "Électrique", "Ferroviaire", "HVAC"]
      },
      {
        name: "Industrialisation",
        ops: "Transfert de production de cartes électroniques, suivi fournisseurs, traitement des non-conformités, optimisation processus.",
        tech: {
          "Langages": ["Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V"],
          "Outils": ["PowerApps", "SolidWorks", "Excel", "ERP (SAP)"]
        },
        sectors: ["Électronique", "Automobile", "Production et robots industriels"]
      },
      {
        name: "FPGA / ASIC / SoC",
        ops: "Conception FPGA (circuit intégré programmable), développement VHDL/Verilog, simulation, vérification, intégration sur silicium.",
        tech: {
          "Langages": ["Matlab", "TCL", "Python", "C"],
          "Systèmes": ["Windows", "Linux", "UNIX", "RTOS", "FreeRTOS"],
          "Méthodologies": ["Cycle en V", "UVM"],
          "Outils": ["ModelSim", "Vivado", "Quartus", "IP Xilinx"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"],
          "Matériel": ["SoC Xilinx", "Oscilloscope", "Générateurs de signaux", "Analyseur de spectre"]
        },
        sectors: ["Semiconducteurs", "Aéronautique", "Défense", "Spatial"]
      }
    ]
  },
  {
    name: "Ingénierie Système",
    icon: "🔧",
    color: "#22c55e",
    specialties: [
      {
        name: "Mécatronique / Robotique",
        ops: "Concevoir, dimensionner et modéliser l'architecture des systèmes mécaniques et électroniques intégrés, prototypage, tests.",
        tech: {
          "Langages": ["Matlab"],
          "Méthodologies": ["Méthode AMDEC", "Cycle en V", "Agile"],
          "Outils CAO": ["Simulink", "Polarion ALM", "SolidWorks", "FreeCAD", "AutoCAD", "CATIA"],
          "Protocoles": ["TCP/IP", "Modbus", "EtherCAT"],
          "Matériel": ["PCB"]
        },
        sectors: ["Production et robots industriels", "Automobile", "Drones", "Défense"]
      },
      {
        name: "Model Based Design (MBD)",
        ops: "Méthode de gestion de projet permettant de tester chaque fonctionnalité sur modèle avant implémentation, génération de code automatique.",
        tech: {
          "Langages": ["Matlab", "C", "C++", "Python"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "IDE": ["Visual Studio", "Eclipse", "IntelliJ IDEA", "PyCharm", "Qt Creator"],
          "Méthodologies": ["Model Based Design"],
          "Outils": ["Simulink", "PLC Coder", "Embedded Coder", "TargetLink", "AUTOSAR"],
          "Protocoles": ["I2C", "CAN", "SPI", "UART", "Ethernet", "Bluetooth"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire"]
      },
      {
        name: "Safety / Sûreté de fonctionnement",
        ops: "Évaluation des risques, analyses de sûreté, définition des exigences de sécurité fonctionnelle, conformité normative.",
        tech: {
          "Langages": ["Matlab"],
          "Méthodologies": ["Cycle en V"],
          "Outils": ["Simulink", "DOORS", "Vector CANoe", "CANape"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire", "Nucléaire"]
      },
      {
        name: "Contrôle commande / Automatique",
        ops: "Lois de commandes, asservissement, pilotage automatique, modélisation et simulation de systèmes dynamiques.",
        tech: {
          "Langages": ["Matlab", "C", "C++"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V", "Model Based Design"],
          "Outils": ["Simulink", "Git"]
        },
        sectors: ["Automobile", "Aéronautique", "Énergie", "Production et robots industriels"]
      },
      {
        name: "Simulation multiphysique / Modélisation",
        ops: "Modélisation physique du système, conception des lois de régulation, simulation thermodynamique et mécanique.",
        tech: {
          "Langages": ["Matlab", "C", "C++", "Python"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V", "Scrum"],
          "Outils CAO": ["Simulink", "Polarion ALM", "SolidWorks", "FreeCAD", "AutoCAD", "CATIA"]
        },
        sectors: ["Automobile", "Aéronautique", "Énergie", "Hydrogène"]
      },
      {
        name: "Mécanique",
        ops: "Conception et développement de solutions sous CATIA, réalisation des calculs de structure, dimensionnement, tolérancement.",
        tech: {
          "Méthodologies": ["Cycle en V"],
          "Outils CAO": ["CATIA", "CREO", "SolidWorks"],
          "Matériel": ["Pièces mécaniques et consommables"]
        },
        sectors: ["Automobile", "Aéronautique", "Spatial", "Défense"]
      },
      {
        name: "Système (ingénierie système)",
        ops: "Analyse des exigences, analyse fonctionnelle, identification des sous-systèmes, allocation des fonctions, spécifications techniques.",
        tech: {
          "Langages": ["C", "C++", "Python", "Matlab"],
          "Systèmes": ["Windows", "Linux", "UNIX"],
          "Méthodologies": ["Cycle en V", "Agile", "Model Based Design", "Méthode Formelle B"],
          "Outils": ["DOORS", "UML", "CAMEO", "JAMA", "Reqtify", "ALM"],
          "Protocoles": ["TCP/IP", "CAN", "LAN", "WAN", "Bluetooth", "LoRa", "Wifi", "I2C", "SPI", "UART"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire", "Spatial", "Défense"]
      },
      {
        name: "Test / Validation / Essais système",
        ops: "Identification des exigences techniques, rédaction des plans d'essais, exécution des tests, gestion de configuration.",
        tech: {
          "Langages": ["Python", "Perl", "Matlab"],
          "Méthodologies": ["Cycle en V", "Agile", "Scrum"],
          "Outils": ["MS Project", "Synergy", "Clearcase", "SVN", "Git"],
          "Protocoles": ["TCP/IP", "CAN", "LAN", "WAN", "Bluetooth", "LoRa", "Wifi", "I2C", "SPI", "UART"]
        },
        sectors: ["Automobile", "Aéronautique", "Ferroviaire", "Spatial"],
        certifs: ["ISTQB"]
      }
    ]
  },
  {
    name: "Life Science",
    icon: "🧬",
    color: "#ec4899",
    specialties: [
      {
        name: "Qualification d'équipements (Pharma & DM)",
        ops: "Rédaction et exécution des protocoles de qualification d'équipements, analyse de risques, gestion des CAPA, documentation qualité.",
        tech: {
          "Méthodologies": ["GMP : IQ / OQ / PQ", "Normes GAMP5"],
          "Outils": ["MasterControl", "Veeva Vault"],
          "Matériel": ["Utilités", "Salles Blanches HVAC", "Machine à laver", "Bioréacteurs"]
        },
        sectors: ["Pharmaceutique", "Dispositifs médicaux", "Biomédical"]
      },
      {
        name: "Validation de systèmes automatisés (VSA)",
        ops: "Analyse des risques et des impacts, qualification et validation des automates, documentation de conformité.",
        tech: {
          "Méthodologies": ["GAMP5", "21 CFR Part 11", "FDA"],
          "Outils": ["MasterControl", "Veeva Vault"],
          "Matériel": ["Automates PLC", "Systèmes SCADA", "DCS"]
        },
        sectors: ["Pharmaceutique", "Dispositifs médicaux", "Biomédical"]
      },
      {
        name: "Validation de systèmes d'informations (VSI)",
        ops: "Analyse des risques et des impacts, qualification et validation des systèmes d'information, conformité réglementaire.",
        tech: {
          "Méthodologies": ["GAMP5", "21 CFR Part 11", "FDA"],
          "Outils": ["MasterControl", "Veeva Vault"],
          "Matériel": ["QMS", "LIMS", "ERP"]
        },
        sectors: ["Pharmaceutique", "Dispositifs médicaux", "Biomédical"]
      },
      {
        name: "Validation de produits (Dispositifs Médicaux)",
        ops: "Rédaction de plans de validation, identification des risques (FMEA), tests et essais cliniques, conformité marquage CE.",
        tech: {
          "Méthodologies": ["ISO 13485", "Marquage CE", "IQ-OP-PQ", "IEC 60601", "IEC 62304", "ISO 26262"],
          "Outils": ["TrackWise", "LabVIEW", "MasterControl", "Veeva Vault"]
        },
        sectors: ["Dispositifs médicaux", "Biomédical", "Pharmaceutique"]
      }
    ]
  }
];

/* Sectors with associated norms */
const SECTORS_DATA = {
  "Aéronautique":        "DO-178 / DO-160",
  "Ferroviaire":         "IRIS / SIL",
  "Automobile":          "ISO 26262 / AUTOSAR / ASIL-D / UDS",
  "Hydrogène":           null,
  "Spatial":             "ECSS",
  "Semiconducteurs":     "AUTOSAR",
  "Nucléaire":           "ISO 19443",
  "Électrique":          "IPC",
  "Agricole":            "ISO 25119",
  "Dispositifs médicaux":"ISO 13485",
  "Électronique":        "CID",
  "Biomédical":          "IEC 62304 / IEC 61508 / 21 CFR Part 11",
  "Pharmaceutique":      "BPF / GMP / GAMP5 / 21 CFR Part 11 / FDA",
  "Énergie":             null,
  "Télécommunications":  null,
  "Métrologie / instrumentation": null,
  "Systèmes de sécurité":null,
  "HVAC":                null,
  "Production et robots industriels": null,
  "Drones":              null,
  "Défense":             null,
  "IoT":                 null
};

/* ── Helper: build flat set of all referential tags ── */
function buildReferentialTagSet() {
  const tags = new Set();
  METIERS_DATA.forEach(m => {
    m.specialties.forEach(sp => {
      Object.values(sp.tech).forEach(arr => arr.forEach(t => tags.add(t.toLowerCase())));
    });
  });
  return tags;
}

/* ── Helper: build autocomplete list (sorted, unique) ── */
function buildAutocompleteTags() {
  const set = new Set();
  METIERS_DATA.forEach(m => {
    m.specialties.forEach(sp => {
      Object.values(sp.tech).forEach(arr => arr.forEach(t => set.add(t)));
    });
  });
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* ── Helper: compute metier match scores for a set of prospect tags ── */
function computeMetierMatches(prospectTags) {
  if (!prospectTags || !prospectTags.length) return [];

  const ptLower = new Set(prospectTags.map(t => t.toLowerCase().trim()));
  const results = [];

  METIERS_DATA.forEach(metier => {
    metier.specialties.forEach(spec => {
      // Collect all tech terms for this specialty
      const allTech = [];
      Object.values(spec.tech).forEach(arr => arr.forEach(t => allTech.push(t.toLowerCase())));
      const techSet = new Set(allTech);

      // Count matching tags
      let matched = 0;
      const matchedTags = [];
      ptLower.forEach(pt => {
        if (techSet.has(pt)) {
          matched++;
          matchedTags.push(pt);
        }
      });

      if (matched > 0) {
        const score = Math.round((matched / ptLower.size) * 100);
        results.push({
          category: metier.name,
          categoryIcon: metier.icon,
          categoryColor: metier.color,
          specialty: spec.name,
          score,
          matched,
          total: ptLower.size,
          matchedTags
        });
      }
    });
  });

  results.sort((a, b) => b.score - a.score || b.matched - a.matched);
  return results;
}
